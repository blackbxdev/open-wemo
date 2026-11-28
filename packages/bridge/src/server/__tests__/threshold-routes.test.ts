/**
 * TDD tests for threshold management API routes.
 *
 * Tests GET /:id/threshold, PUT /:id/threshold, POST /:id/threshold/reset
 * on the device routes.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type SavedDevice, type WemoDevice, WemoDeviceType } from "../../wemo/types";

// ── Mock setup (BEFORE imports) ─────────────────────────────────────────────
//
// The threshold endpoints drive the real InsightDeviceClient, which talks
// to the device with soapRequest. Stub fetch (the transport) instead of
// mocking ../../wemo/soap: the real SOAP envelope building, XML parsing,
// and value extraction run, and no process-global mock.module override
// leaks into other test files (device.test.ts and soap.test.ts need the
// real soap module and broke under `bun test --randomize`). The
// ../../wemo/device mock is gone too — it replaced WemoDeviceClient with
// a stub class that has no setBrightness/getState, which broke
// device.test.ts outright when this file loaded first — and the
// ../../wemo/scheduler mock is gone because importing the real scheduler
// is side-effect-free (startScheduler is only called explicitly) and
// the threshold endpoints never delete a device.

const mockGetDeviceById = mock((_id: string): SavedDevice | null => null);
mock.module("../../db", () => ({
  getDatabase: () => ({
    getDeviceById: mockGetDeviceById,
    getAllDevices: () => [],
    saveDevice: () => {},
    deleteDevice: () => {},
  }),
}));

const mockGetDeviceByAddress = mock(
  (_host: string, _port: number): Promise<WemoDevice | null> => Promise.resolve(null)
);
mock.module("../../wemo/discovery", () => ({
  getDeviceByAddress: mockGetDeviceByAddress,
}));

// ── Transport stub ─────────────────────────────────────────────────────────
type FetchCall = { url: string; body: string; soapAction: string | undefined };
const fetchCalls: FetchCall[] = [];
const originalFetch = globalThis.fetch;
// Inner XML queued for the next fetch call, one entry per call, in order.
// The stub wraps each entry in the response element matching the
// requested action, so a test queues just the fields it cares about.
const queuedInnerXml: string[] = [];

function queueSoapInner(innerXml: string): void {
  queuedInnerXml.push(innerXml);
}

function stubFetch() {
  globalThis.fetch = (async (
    url: unknown,
    init?: { body?: unknown; headers?: Record<string, string> }
  ) => {
    const body = String(init?.body ?? "");
    const soapAction = init?.headers?.SOAPACTION;
    fetchCalls.push({ url: String(url), body, soapAction });
    const action = (soapAction ?? "").replace(/"/g, "").split("#")[1] ?? "";
    const inner = queuedInnerXml.shift() ?? "";
    const xml = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action}Response xmlns:u="urn:Belkin:service:insight:1">${inner}</u:${action}Response></s:Body></s:Envelope>`;
    return { ok: true, status: 200, text: async () => xml } as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  fetchCalls.length = 0;
  queuedInnerXml.length = 0;
  stubFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── Imports (after mocks) ───────────────────────────────────────────────────

import { toApiError } from "../errors";
import { deviceRoutes } from "../routes/devices";

// ── Test app factory ────────────────────────────────────────────────────────

function createTestApp(): Hono {
  const app = new Hono();
  app.route("/api/devices", deviceRoutes);
  app.onError((err, c) => {
    const apiError = toApiError(err);
    return c.json(apiError.toJSON(), apiError.status as ContentfulStatusCode);
  });
  return app;
}

// ── Fixture data ────────────────────────────────────────────────────────────

const INSIGHT_SAVED: SavedDevice = {
  id: "insight-1",
  name: "Test Insight",
  deviceType: WemoDeviceType.Insight,
  host: "192.168.1.100",
  port: 49153,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const SWITCH_SAVED: SavedDevice = {
  id: "switch-1",
  name: "Test Switch",
  deviceType: WemoDeviceType.Switch,
  host: "192.168.1.101",
  port: 49153,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const WEMO_INSIGHT: WemoDevice = {
  id: "insight-1",
  name: "Test Insight",
  deviceType: WemoDeviceType.Insight,
  host: "192.168.1.100",
  port: 49153,
  manufacturer: "Belkin",
  model: "Insight",
  serialNumber: "ABC123",
  firmwareVersion: "1.0",
  macAddress: "AA:BB:CC:DD:EE:FF",
  services: [],
  setupUrl: "http://192.168.1.100:49153/setup.xml",
};

const WEMO_SWITCH: WemoDevice = {
  id: "switch-1",
  name: "Test Switch",
  deviceType: WemoDeviceType.Switch,
  host: "192.168.1.101",
  port: 49153,
  manufacturer: "Belkin",
  model: "Socket",
  serialNumber: "DEF456",
  firmwareVersion: "1.0",
  macAddress: "FF:EE:DD:CC:BB:AA",
  services: [],
  setupUrl: "http://192.168.1.101:49153/setup.xml",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

interface ThresholdBody {
  id: string;
  thresholdWatts: number;
  thresholdMilliwatts: number;
}

interface ErrorBody {
  error: boolean;
  code: string;
  message: string;
  fields?: string[];
}

function setupInsightDevice() {
  mockGetDeviceById.mockReturnValue(INSIGHT_SAVED);
  mockGetDeviceByAddress.mockResolvedValue(WEMO_INSIGHT);
}

function setupSwitchDevice() {
  mockGetDeviceById.mockReturnValue(SWITCH_SAVED);
  mockGetDeviceByAddress.mockResolvedValue(WEMO_SWITCH);
}

function queueThresholdResponse(milliwatts: number) {
  queueSoapInner(`<PowerThreshold>${milliwatts}</PowerThreshold>`);
}

function queueSoapSuccess() {
  queueSoapInner("");
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/devices/:id/threshold", () => {
  let app: Hono;

  beforeEach(() => {
    app = createTestApp();
    mockGetDeviceById.mockReset();
    mockGetDeviceByAddress.mockReset();
  });

  test("returns threshold data for Insight device", async () => {
    setupInsightDevice();
    queueThresholdResponse(8000);

    const res = await app.request("/api/devices/insight-1/threshold");
    const body = (await res.json()) as ThresholdBody;

    expect(res.status).toBe(200);
    expect(body).toEqual({
      id: "insight-1",
      thresholdWatts: 8,
      thresholdMilliwatts: 8000,
    });
  });

  test("thresholdWatts equals thresholdMilliwatts / 1000", async () => {
    setupInsightDevice();
    queueThresholdResponse(3500);

    const res = await app.request("/api/devices/insight-1/threshold");
    const body = (await res.json()) as ThresholdBody;

    expect(res.status).toBe(200);
    expect(body.thresholdWatts).toBe(body.thresholdMilliwatts / 1000);
    expect(body.thresholdWatts).toBe(3.5);
    expect(body.thresholdMilliwatts).toBe(3500);
  });

  test("returns 404 for non-existent device", async () => {
    mockGetDeviceById.mockReturnValue(null);

    const res = await app.request("/api/devices/nonexistent/threshold");
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(404);
    expect(body.code).toBe("DEVICE_NOT_FOUND");
  });

  test("returns 400 for non-Insight device", async () => {
    setupSwitchDevice();

    const res = await app.request("/api/devices/switch-1/threshold");
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(400);
    expect(body.code).toBe("INSIGHT_NOT_SUPPORTED");
  });
});

describe("PUT /api/devices/:id/threshold", () => {
  let app: Hono;

  beforeEach(() => {
    app = createTestApp();
    mockGetDeviceById.mockReset();
    mockGetDeviceByAddress.mockReset();
  });

  test("sets threshold with watts: 5 → sends 5000mW SOAP body", async () => {
    setupInsightDevice();
    queueSoapSuccess();

    const res = await app.request("/api/devices/insight-1/threshold", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watts: 5 }),
    });
    const body = (await res.json()) as ThresholdBody;

    expect(res.status).toBe(200);
    expect(body).toEqual({
      id: "insight-1",
      thresholdWatts: 5,
      thresholdMilliwatts: 5000,
    });
    expect(fetchCalls[0]?.body).toContain("<PowerThreshold>5000</PowerThreshold>");
  });

  test("handles fractional watts: 0.5 → sends 500mW SOAP body", async () => {
    setupInsightDevice();
    queueSoapSuccess();

    const res = await app.request("/api/devices/insight-1/threshold", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watts: 0.5 }),
    });
    const body = (await res.json()) as ThresholdBody;

    expect(res.status).toBe(200);
    expect(body.thresholdMilliwatts).toBe(500);
    expect(fetchCalls[0]?.body).toContain("<PowerThreshold>500</PowerThreshold>");
  });

  test("rejects negative watts", async () => {
    setupInsightDevice();

    const res = await app.request("/api/devices/insight-1/threshold", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watts: -1 }),
    });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.fields).toEqual(["watts"]);
  });

  test("rejects watts > 50", async () => {
    setupInsightDevice();

    const res = await app.request("/api/devices/insight-1/threshold", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watts: 51 }),
    });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.fields).toEqual(["watts"]);
  });

  test("rejects string watts", async () => {
    setupInsightDevice();

    const res = await app.request("/api/devices/insight-1/threshold", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watts: "abc" }),
    });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.fields).toEqual(["watts"]);
  });

  test("rejects empty body (missing watts)", async () => {
    setupInsightDevice();

    const res = await app.request("/api/devices/insight-1/threshold", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.fields).toEqual(["watts"]);
  });

  test("rejects null watts", async () => {
    setupInsightDevice();

    const res = await app.request("/api/devices/insight-1/threshold", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watts: null }),
    });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.fields).toEqual(["watts"]);
  });

  test("returns 404 for non-existent device", async () => {
    mockGetDeviceById.mockReturnValue(null);

    const res = await app.request("/api/devices/nonexistent/threshold", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watts: 5 }),
    });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(404);
    expect(body.code).toBe("DEVICE_NOT_FOUND");
  });

  test("returns 400 for non-Insight device", async () => {
    setupSwitchDevice();

    const res = await app.request("/api/devices/switch-1/threshold", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watts: 5 }),
    });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(400);
    expect(body.code).toBe("INSIGHT_NOT_SUPPORTED");
  });
});

describe("POST /api/devices/:id/threshold/reset", () => {
  let app: Hono;

  beforeEach(() => {
    app = createTestApp();
    mockGetDeviceById.mockReset();
    mockGetDeviceByAddress.mockReset();
  });

  test("calls ResetPowerThreshold then GetPowerThreshold (confirm-after-reset)", async () => {
    setupInsightDevice();
    queueSoapSuccess();
    queueThresholdResponse(8000);

    const res = await app.request("/api/devices/insight-1/threshold/reset", {
      method: "POST",
    });
    await res.json();

    expect(res.status).toBe(200);
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0]?.soapAction).toBe('"urn:Belkin:service:insight:1#ResetPowerThreshold"');
    expect(fetchCalls[1]?.soapAction).toBe('"urn:Belkin:service:insight:1#GetPowerThreshold"');
  });

  test("returns confirmed threshold value from GetPowerThreshold", async () => {
    setupInsightDevice();
    queueSoapSuccess();
    queueThresholdResponse(8000);

    const res = await app.request("/api/devices/insight-1/threshold/reset", {
      method: "POST",
    });
    const body = (await res.json()) as ThresholdBody;

    expect(res.status).toBe(200);
    expect(body).toEqual({
      id: "insight-1",
      thresholdWatts: 8,
      thresholdMilliwatts: 8000,
    });
  });

  test("returns 404 for non-existent device", async () => {
    mockGetDeviceById.mockReturnValue(null);

    const res = await app.request("/api/devices/nonexistent/threshold/reset", {
      method: "POST",
    });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(404);
    expect(body.code).toBe("DEVICE_NOT_FOUND");
  });

  test("returns 400 for non-Insight device", async () => {
    setupSwitchDevice();

    const res = await app.request("/api/devices/switch-1/threshold/reset", {
      method: "POST",
    });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(400);
    expect(body.code).toBe("INSIGHT_NOT_SUPPORTED");
  });
});
