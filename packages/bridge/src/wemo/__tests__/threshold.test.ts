import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// ── Transport stub ─────────────────────────────────────────────────────────
// The Insight client talks to the device with soapRequest, which POSTs
// to the device. Stub fetch (the transport) instead of mocking ../soap:
// the real SOAP envelope building, XML parsing, and value extraction
// run, and no process-global mock.module override leaks into other
// test files (device.test.ts and soap.test.ts need the real soap module
// and broke under `bun test --randomize`).
type FetchCall = { url: string; body: string; soapAction: string | undefined };
const fetchCalls: FetchCall[] = [];
const originalFetch = globalThis.fetch;
// Inner XML queued for the next fetch call, one entry per call, in order.
// The stub wraps each entry in the response element matching the
// requested action, so a test queues just the fields it cares about.
const queuedInnerXml: string[] = [];
let nextFetchOk = true;

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
    if (!nextFetchOk) {
      nextFetchOk = true;
      return {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "",
      } as Response;
    }
    const action = (soapAction ?? "").replace(/"/g, "").split("#")[1] ?? "";
    const inner = queuedInnerXml.shift() ?? "";
    const xml = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action}Response xmlns:u="urn:Belkin:service:insight:1">${inner}</u:${action}Response></s:Body></s:Envelope>`;
    return { ok: true, status: 200, text: async () => xml } as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  fetchCalls.length = 0;
  queuedInnerXml.length = 0;
  nextFetchOk = true;
  stubFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── Setup ──────────────────────────────────────────────────────────────────────

import { InsightDeviceClient } from "../insight";
import { WemoDeviceType } from "../types";
import type { WemoDevice } from "../types";

function createMockDevice(): WemoDevice {
  return {
    id: "test-insight-001",
    name: "Test Insight",
    deviceType: WemoDeviceType.Insight,
    host: "192.168.1.100",
    port: 49153,
    manufacturer: "Belkin International Inc.",
    model: "Insight",
    serialNumber: "ABC123",
    firmwareVersion: "1.0.0",
    macAddress: "AA:BB:CC:DD:EE:FF",
    services: [
      {
        serviceType: "urn:Belkin:service:basicevent:1",
        serviceId: "urn:Belkin:serviceId:basicevent1",
        controlURL: "/upnp/control/basicevent1",
        eventSubURL: "/upnp/event/basicevent1",
        SCPDURL: "/eventservice.xml",
      },
      {
        serviceType: "urn:Belkin:service:insight:1",
        serviceId: "urn:Belkin:serviceId:insight1",
        controlURL: "/upnp/control/insight1",
        eventSubURL: "/upnp/event/insight1",
        SCPDURL: "/insightservice.xml",
      },
    ],
    setupUrl: "http://192.168.1.100:49153/setup.xml",
  };
}

let client: InsightDeviceClient;

beforeEach(() => {
  client = new InsightDeviceClient(createMockDevice());
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("InsightDeviceClient threshold methods", () => {
  describe("getPowerThreshold()", () => {
    test("calls soapRequest with correct parameters", async () => {
      queueSoapInner("<PowerThreshold>8000</PowerThreshold>");

      await client.getPowerThreshold();

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]?.url).toBe("http://192.168.1.100:49153/upnp/control/insight1");
      expect(fetchCalls[0]?.soapAction).toBe('"urn:Belkin:service:insight:1#GetPowerThreshold"');
    });

    test("returns number (milliwatts) from response", async () => {
      queueSoapInner("<PowerThreshold>5000</PowerThreshold>");

      const result = await client.getPowerThreshold();

      expect(result).toBe(5000);
      expect(typeof result).toBe("number");
    });

    test("throws Error when response.success is false", async () => {
      nextFetchOk = false;

      await expect(client.getPowerThreshold()).rejects.toThrow(/failed to get.*powerthreshold/i);
    });

    test("returns 0 for empty/missing PowerThreshold field", async () => {
      queueSoapInner("");

      const result = await client.getPowerThreshold();

      expect(result).toBe(0);
    });

    test("returns 0 for non-numeric PowerThreshold value", async () => {
      queueSoapInner("<PowerThreshold>notanumber</PowerThreshold>");

      const result = await client.getPowerThreshold();

      expect(result).toBe(0);
    });
  });

  describe("setPowerThreshold()", () => {
    test("calls soapRequest with correct parameters and body", async () => {
      queueSoapInner("");

      await client.setPowerThreshold(5000);

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]?.url).toBe("http://192.168.1.100:49153/upnp/control/insight1");
      expect(fetchCalls[0]?.soapAction).toBe('"urn:Belkin:service:insight:1#SetPowerThreshold"');
      expect(fetchCalls[0]?.body).toContain("<PowerThreshold>5000</PowerThreshold>");
    });

    test("uses correct service and controlURL", async () => {
      queueSoapInner("");

      await client.setPowerThreshold(3000);

      expect(fetchCalls[0]?.url).toBe("http://192.168.1.100:49153/upnp/control/insight1");
      expect(fetchCalls[0]?.soapAction).toBe('"urn:Belkin:service:insight:1#SetPowerThreshold"');
    });

    test("throws Error when response.success is false", async () => {
      nextFetchOk = false;

      await expect(client.setPowerThreshold(5000)).rejects.toThrow(
        /failed to set.*powerthreshold/i
      );
    });

    test("sends integer milliwatts in body", async () => {
      queueSoapInner("");

      await client.setPowerThreshold(7500);

      expect(fetchCalls[0]?.body).toContain("<PowerThreshold>7500</PowerThreshold>");
    });
  });

  describe("resetPowerThreshold()", () => {
    test("calls soapRequest with ResetPowerThreshold action and 8000mW default", async () => {
      queueSoapInner("");

      await client.resetPowerThreshold();

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]?.url).toBe("http://192.168.1.100:49153/upnp/control/insight1");
      expect(fetchCalls[0]?.soapAction).toBe('"urn:Belkin:service:insight:1#ResetPowerThreshold"');
      expect(fetchCalls[0]?.body).toContain("<PowerThreshold>8000</PowerThreshold>");
    });

    test("uses correct service and controlURL", async () => {
      queueSoapInner("");

      await client.resetPowerThreshold();

      expect(fetchCalls[0]?.url).toBe("http://192.168.1.100:49153/upnp/control/insight1");
      expect(fetchCalls[0]?.soapAction).toBe('"urn:Belkin:service:insight:1#ResetPowerThreshold"');
    });

    test("throws Error when response.success is false", async () => {
      nextFetchOk = false;

      await expect(client.resetPowerThreshold()).rejects.toThrow(
        /failed to reset.*powerthreshold/i
      );
    });
  });
});
