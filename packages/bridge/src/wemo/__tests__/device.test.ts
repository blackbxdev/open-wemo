/**
 * Tests for WemoDeviceClient brightness control.
 *
 * The transport (global fetch) is stubbed, not the soap module, so the
 * real SOAP envelope building, XML parsing, and value extraction run.
 * Fixture responses are verbatim SOAP bodies recorded by pyWeMo's VCR
 * cassettes for the OWRT v1 (WeMo_WW_2.00.11453.PVT-OWRT-Dimmer) and
 * RTOS v2 (WEMO_WW_2.00.20110904.PVT-RTOS-DimmerV2) dimmers
 * (pywemo/tests/vcr/tests.ouimeaux_device.test_dimmer).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

// This file stubs the transport (fetch), not the soap module, so the
// real SOAP envelope building, XML parsing, and value extraction run.
// No test file mocks ../soap anymore: scheduler.test.ts, threshold.test.ts,
// and threshold-routes.test.ts all stub fetch too, so there is no
// process-global mock.module override left to leak across files and
// break this file (or soap.test.ts) under `bun test --randomize`.
// (A query-suffixed re-import used to re-assert the real module here;
// it hung the suite at load on Bun 1.3.9 and is gone with the mocks.)

import { WemoDeviceClient } from "../device";
import { parseXmlResponse } from "../soap";
import { WemoDeviceType } from "../types";
import type { WemoDevice } from "../types";

// ── Fixtures ───────────────────────────────────────────────────────────────────

let owrtGetState: string;
let rtosGetState: string;
let rtosGetStateOff: string;
let owrtSetResponse: string;
let rtosSetResponse: string;

beforeAll(async () => {
  const load = (name: string) => Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text();
  [owrtGetState, rtosGetState, rtosGetStateOff, owrtSetResponse, rtosSetResponse] =
    await Promise.all([
      load("dimmer-owrt-v1-get-binary-state.xml"),
      load("dimmer-rtos-v2-get-binary-state.xml"),
      load("dimmer-rtos-v2-get-binary-state-off.xml"),
      load("dimmer-owrt-v1-set-binary-state-response.xml"),
      load("dimmer-rtos-v2-set-binary-state-response.xml"),
    ]);
});

// ── Transport stub ─────────────────────────────────────────────────────────────

type FetchCall = { url: string; body: string; soapAction: string | undefined };
const fetchCalls: FetchCall[] = [];
let nextResponseXml = "";
let nextSetResponseXml = "";

const originalFetch = globalThis.fetch;

function stubFetch() {
  globalThis.fetch = (async (
    url: unknown,
    init?: { body?: unknown; headers?: Record<string, string> }
  ) => {
    const body = String(init?.body ?? "");
    fetchCalls.push({
      url: String(url),
      body,
      soapAction: init?.headers?.SOAPACTION,
    });
    // The Set response is the device's confirmed state; the Get response
    // is the polled state. Keep them separate so a Set that turns the
    // device off is not "confirmed" by a stale on-state recording.
    const isSet = (init?.headers?.SOAPACTION ?? "").includes("SetBinaryState");
    return {
      ok: true,
      status: 200,
      text: async () => (isSet ? nextSetResponseXml : nextResponseXml),
    } as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  fetchCalls.length = 0;
  nextResponseXml = rtosGetState;
  nextSetResponseXml = rtosSetResponse;
  stubFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── Setup ──────────────────────────────────────────────────────────────────────

function createMockDevice(deviceType: WemoDeviceType): WemoDevice {
  return {
    id: "test-dimmer-001",
    name: "Test Dimmer",
    deviceType,
    host: "192.168.1.100",
    port: 49153,
    manufacturer: "Belkin International Inc.",
    model: "Dimmer",
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
    ],
    setupUrl: "http://192.168.1.100:49153/setup.xml",
  };
}

let client: WemoDeviceClient;

beforeEach(() => {
  client = new WemoDeviceClient(createMockDevice(WemoDeviceType.Dimmer));
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("WemoDeviceClient brightness", () => {
  describe("setBrightness()", () => {
    test("sends SetBinaryState with brightness for a level", async () => {
      await client.setBrightness(75);
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]?.soapAction).toBe('"urn:Belkin:service:basicevent:1#SetBinaryState"');
      expect(fetchCalls[0]?.body).toContain("<BinaryState>1</BinaryState>");
      expect(fetchCalls[0]?.body).toContain("<brightness>75</brightness>");
    });

    test("clamps levels above 100", async () => {
      await client.setBrightness(150);
      expect(fetchCalls[0]?.body).toContain("<brightness>100</brightness>");
    });

    test("clamps negative levels to 0 and turns off", async () => {
      await client.setBrightness(-10);
      expect(fetchCalls[0]?.body).toContain("<BinaryState>0</BinaryState>");
      expect(fetchCalls[0]?.body).not.toContain("brightness");
    });

    test("level 0 turns the device off without a brightness element", async () => {
      await client.setBrightness(0);
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]?.body).toContain("<BinaryState>0</BinaryState>");
      expect(fetchCalls[0]?.body).not.toContain("<brightness>");
    });

    test("rounds fractional levels", async () => {
      await client.setBrightness(42.6);
      expect(fetchCalls[0]?.body).toContain("<brightness>43</brightness>");
    });

    test("a nonzero level that rounds to 0 turns the device on at 1", async () => {
      await client.setBrightness(0.4);
      expect(fetchCalls[0]?.body).toContain("<BinaryState>1</BinaryState>");
      expect(fetchCalls[0]?.body).toContain("<brightness>1</brightness>");
    });

    test("returns the effective level sent to the device", async () => {
      await expect(client.setBrightness(0.4)).resolves.toMatchObject({ level: 1 });
      await expect(client.setBrightness(75)).resolves.toMatchObject({ level: 75 });
      await expect(client.setBrightness(0)).resolves.toMatchObject({ level: 0 });
    });

    test("returns the state the Set response carries", async () => {
      // The stub returns the RTOS v2 Set recording (BinaryState 1,
      // brightness 45) for the Set call: that is the confirmed state.
      const result = await client.setBrightness(60);
      expect(result.level).toBe(60);
      expect(result.state).toEqual({ binaryState: 1, brightness: 45 });
    });

    test("returns no state when the Set response carries none", async () => {
      nextSetResponseXml = `<?xml version="1.0"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:SetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1">
            </u:SetBinaryStateResponse>
          </s:Body>
        </s:Envelope>`;
      const result = await client.setBrightness(60);
      expect(result.level).toBe(60);
      expect(result.state).toBeUndefined();
    });

    test("level 0 returns the Set response state for the off command", async () => {
      nextSetResponseXml = `<?xml version="1.0"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:SetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1">
              <BinaryState>0</BinaryState>
            </u:SetBinaryStateResponse>
          </s:Body>
        </s:Envelope>`;
      const result = await client.setBrightness(0);
      expect(result.level).toBe(0);
      expect(result.state).toEqual({ binaryState: 0 });
    });

    test("refuses a plain Switch without sending anything", async () => {
      const switchClient = new WemoDeviceClient(createMockDevice(WemoDeviceType.Switch));
      await expect(switchClient.setBrightness(50)).rejects.toThrow(
        /does not support brightness control/
      );
      expect(fetchCalls).toHaveLength(0);
    });

    test("refuses a Link-bridge Bulb without sending anything", async () => {
      const bulbClient = new WemoDeviceClient(createMockDevice(WemoDeviceType.Bulb));
      await expect(bulbClient.setBrightness(50)).rejects.toThrow(
        /does not support brightness control/
      );
      expect(fetchCalls).toHaveLength(0);
    });
  });

  describe("getBrightness()", () => {
    test("returns the brightness reported by the device (RTOS v2 recording)", async () => {
      nextResponseXml = rtosGetState;
      await expect(client.getBrightness()).resolves.toBe(45);
    });

    test("returns the brightness reported by the device (OWRT v1 recording)", async () => {
      nextResponseXml = owrtGetState;
      await expect(client.getBrightness()).resolves.toBe(45);
    });

    test("returns undefined when the device reports no brightness", async () => {
      nextResponseXml = `<?xml version="1.0"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:GetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1">
              <BinaryState>1</BinaryState>
            </u:GetBinaryStateResponse>
          </s:Body>
        </s:Envelope>`;
      await expect(client.getBrightness()).resolves.toBeUndefined();
    });

    test("returns undefined for a malformed brightness value", async () => {
      nextResponseXml = `<?xml version="1.0"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:GetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1">
              <BinaryState>1</BinaryState>
              <brightness>not-a-number</brightness>
            </u:GetBinaryStateResponse>
          </s:Body>
        </s:Envelope>`;
      await expect(client.getBrightness()).resolves.toBeUndefined();
    });
  });

  describe("getState()", () => {
    test("parses power and brightness from a single round trip (RTOS v2)", async () => {
      nextResponseXml = rtosGetState;
      const state = await client.getState();
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]?.soapAction).toBe('"urn:Belkin:service:basicevent:1#GetBinaryState"');
      expect(state.binaryState).toBe(1);
      expect(state.brightness).toBe(45);
    });

    test("parses power and brightness from a single round trip (OWRT v1)", async () => {
      nextResponseXml = owrtGetState;
      const state = await client.getState();
      expect(fetchCalls).toHaveLength(1);
      expect(state.binaryState).toBe(1);
      expect(state.brightness).toBe(45);
    });

    test("keeps the last brightness when the device is off", async () => {
      nextResponseXml = rtosGetStateOff;
      const state = await client.getState();
      expect(state.binaryState).toBe(0);
      expect(state.brightness).toBe(100);
    });

    test("omits brightness when the device does not report one", async () => {
      nextResponseXml = `<?xml version="1.0"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:GetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1">
              <BinaryState>0</BinaryState>
            </u:GetBinaryStateResponse>
          </s:Body>
        </s:Envelope>`;
      const state = await client.getState();
      expect(fetchCalls).toHaveLength(1);
      expect(state.binaryState).toBe(0);
      expect(state.brightness).toBeUndefined();
    });

    test("parses the first field of a compound BinaryState (8|123 = standby)", async () => {
      nextResponseXml = `<?xml version="1.0"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:GetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1">
              <BinaryState>8|123</BinaryState>
              <brightness>45</brightness>
            </u:GetBinaryStateResponse>
          </s:Body>
        </s:Envelope>`;
      const state = await client.getState();
      expect(state.binaryState).toBe(8);
      expect(state.brightness).toBe(45);
    });

    test("treats a missing BinaryState as off", async () => {
      nextResponseXml = `<?xml version="1.0"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:GetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1">
              <brightness>45</brightness>
            </u:GetBinaryStateResponse>
          </s:Body>
        </s:Envelope>`;
      const state = await client.getState();
      expect(state.binaryState).toBe(0);
      expect(state.brightness).toBe(45);
    });

    test("treats a garbage BinaryState as off", async () => {
      nextResponseXml = `<?xml version="1.0"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:GetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1">
              <BinaryState>garbage</BinaryState>
              <brightness>45</brightness>
            </u:GetBinaryStateResponse>
          </s:Body>
        </s:Envelope>`;
      const state = await client.getState();
      expect(state.binaryState).toBe(0);
      expect(state.brightness).toBe(45);
    });

    test("treats an Infinity brightness as unknown, not 100", async () => {
      nextResponseXml = `<?xml version="1.0"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:GetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1">
              <BinaryState>1</BinaryState>
              <brightness>Infinity</brightness>
            </u:GetBinaryStateResponse>
          </s:Body>
        </s:Envelope>`;
      const state = await client.getState();
      expect(state.binaryState).toBe(1);
      expect(state.brightness).toBeUndefined();
      await expect(client.getBrightness()).resolves.toBeUndefined();
    });

    test("keeps a valid power state when brightness is malformed", async () => {
      nextResponseXml = `<?xml version="1.0"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:GetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1">
              <BinaryState>1</BinaryState>
              <brightness>not-a-number</brightness>
            </u:GetBinaryStateResponse>
          </s:Body>
        </s:Envelope>`;
      const state = await client.getState();
      expect(state.binaryState).toBe(1);
      expect(state.brightness).toBeUndefined();
    });
  });

  describe("getBinaryState()", () => {
    test("returns undefined for a garbage BinaryState", async () => {
      nextResponseXml = `<?xml version="1.0"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:GetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1">
              <BinaryState>garbage</BinaryState>
            </u:GetBinaryStateResponse>
          </s:Body>
        </s:Envelope>`;
      await expect(client.getBinaryState()).resolves.toBeUndefined();
    });

    test("returns undefined for a missing BinaryState", async () => {
      nextResponseXml = `<?xml version="1.0"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:GetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1">
            </u:GetBinaryStateResponse>
          </s:Body>
        </s:Envelope>`;
      await expect(client.getBinaryState()).resolves.toBeUndefined();
    });
  });

  describe("toggle()", () => {
    test("sends off when the device is on", async () => {
      // Default fixture (RTOS v2) reports BinaryState 1.
      const state = await client.toggle();
      expect(state.binaryState).toBe(0);
      expect(fetchCalls).toHaveLength(2);
      expect(fetchCalls[1]?.body).toContain("<BinaryState>0</BinaryState>");
    });

    test("refuses when the reported state is garbage instead of guessing", async () => {
      nextResponseXml = `<?xml version="1.0"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:GetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1">
              <BinaryState>garbage</BinaryState>
            </u:GetBinaryStateResponse>
          </s:Body>
        </s:Envelope>`;
      // Guessing off would send "on" to a device that may already be
      // on. Refuse, and send nothing: only the state read, no Set.
      await expect(client.toggle()).rejects.toThrow(/state is unknown/);
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]?.soapAction).toContain("GetBinaryState");
    });

    test("refuses when the BinaryState is missing", async () => {
      nextResponseXml = `<?xml version="1.0"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:GetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1">
            </u:GetBinaryStateResponse>
          </s:Body>
        </s:Envelope>`;
      await expect(client.toggle()).rejects.toThrow(/state is unknown/);
      expect(fetchCalls).toHaveLength(1);
    });
  });

  describe("recorded SetBinaryState responses", () => {
    test("RTOS v2 Set response carries the confirmed brightness", () => {
      const parsed = parseXmlResponse<{ BinaryState: number; brightness: number }>(
        rtosSetResponse,
        "SetBinaryState"
      );
      expect(parsed.BinaryState).toBe(1);
      expect(parsed.brightness).toBe(45);
    });

    test("OWRT v1 Set response carries the confirmed brightness", () => {
      const parsed = parseXmlResponse<{ BinaryState: number; brightness: number }>(
        owrtSetResponse,
        "SetBinaryState"
      );
      expect(parsed.BinaryState).toBe(1);
      expect(parsed.brightness).toBe(45);
    });
  });
});
