/**
 * TDD tests for threshold management API routes.
 *
 * Tests GET /:id/threshold, PUT /:id/threshold, POST /:id/threshold/reset
 * on the device routes.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type SavedDevice, type WemoDevice, WemoDeviceType } from "../../wemo/types";

// ── Mock setup (BEFORE imports) ─────────────────────────────────────────────
//
// We mock ../../wemo/soap (not ../../wemo/insight) so the real InsightDeviceClient
// class is preserved. bun:test mock.module is global — mocking the insight module
// would break threshold.test.ts which needs the real class with mocked SOAP.

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

mock.module("../../wemo/device", () => ({
  WemoDeviceClient: class MockWemoDeviceClient {
    getBinaryState = mock(() => Promise.resolve(1));
    turnOn = mock(() => Promise.resolve());
    turnOff = mock(() => Promise.resolve());
    toggle = mock(() => Promise.resolve({ binaryState: 1 }));
  },
}));

mock.module("../../wemo/scheduler", () => ({
  clearDeviceRules: () => {},
}));

const mockSoapRequest = mock(
  (): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> =>
    Promise.resolve({ success: true, data: {} })
);
mock.module("../../wemo/soap", () => ({
  soapRequest: mockSoapRequest,
  extractNumericValue: (value: unknown): number => {
    if (typeof value === "number") return Number.isNaN(value) ? 0 : value;
    const text =
      typeof value === "string"
        ? value
        : value && typeof value === "object" && "#text" in value
          ? String((value as { "#text": unknown })["#text"])
          : "";
    const num = Number(text);
    return Number.isNaN(num) ? 0 : num;
  },
  extractTextValue: (value: unknown): string => {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (value && typeof value === "object" && "#text" in value)
      return String((value as { "#text": unknown })["#text"]);
    return "";
  },
}));

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

function mockSoapGetThreshold(milliwatts: number) {
  mockSoapRequest.mockResolvedValueOnce({
    success: true,
    data: { PowerThreshold: String(milliwatts) },
  });
}

function mockSoapSuccess() {
  mockSoapRequest.mockResolvedValueOnce({ success: true, data: {} });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/devices/:id/threshold", () => {
  let app: Hono;

  beforeEach(() => {
    app = createTestApp();
    mockGetDeviceById.mockReset();
    mockGetDeviceByAddress.mockReset();
    mockSoapRequest.mockReset();
  });

  test("returns threshold data for Insight device", async () => {
    setupInsightDevice();
    mockSoapGetThreshold(8000);

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
    mockSoapGetThreshold(3500);

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
    mockSoapRequest.mockReset();
  });

  test("sets threshold with watts: 5 → sends 5000mW SOAP body", async () => {
    setupInsightDevice();
    mockSoapSuccess();

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
    const call = mockSoapRequest.mock.calls[0] as unknown as unknown[];
    expect(call[5]).toBe("<PowerThreshold>5000</PowerThreshold>");
  });

  test("handles fractional watts: 0.5 → sends 500mW SOAP body", async () => {
    setupInsightDevice();
    mockSoapSuccess();

    const res = await app.request("/api/devices/insight-1/threshold", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watts: 0.5 }),
    });
    const body = (await res.json()) as ThresholdBody;

    expect(res.status).toBe(200);
    expect(body.thresholdMilliwatts).toBe(500);
    const call = mockSoapRequest.mock.calls[0] as unknown as unknown[];
    expect(call[5]).toBe("<PowerThreshold>500</PowerThreshold>");
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
    mockSoapRequest.mockReset();
  });

  test("calls ResetPowerThreshold then GetPowerThreshold (confirm-after-reset)", async () => {
    setupInsightDevice();
    mockSoapSuccess();
    mockSoapGetThreshold(8000);

    const res = await app.request("/api/devices/insight-1/threshold/reset", {
      method: "POST",
    });
    await res.json();

    expect(res.status).toBe(200);
    expect(mockSoapRequest).toHaveBeenCalledTimes(2);
    const calls = mockSoapRequest.mock.calls as unknown as unknown[][];
    expect(calls[0]?.[4]).toBe("ResetPowerThreshold");
    expect(calls[1]?.[4]).toBe("GetPowerThreshold");
  });

  test("returns confirmed threshold value from GetPowerThreshold", async () => {
    setupInsightDevice();
    mockSoapSuccess();
    mockSoapGetThreshold(8000);

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
