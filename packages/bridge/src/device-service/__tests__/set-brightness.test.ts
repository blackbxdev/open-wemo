/**
 * Tests for DeviceService.setBrightness: the confirmed-state flow.
 *
 * The service is exercised with its two seams patched on the instance —
 * requireDevice (the saved record) and getDeviceClient (the live
 * discovered device) — so no module mocks are needed and this file
 * cannot leak a mock into another test file. The transport (fetch) is
 * stubbed, so the real WemoDeviceClient and SOAP parsing run.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { WemoDeviceClient } from "../../wemo/device";
import { WemoDeviceType } from "../../wemo/types";
import type { SavedDevice, WemoDevice } from "../../wemo/types";
import { DeviceService } from "../index";

// ── Transport stub ─────────────────────────────────────────────────────────

type FetchCall = { url: string; body: string; soapAction: string | undefined };
const fetchCalls: FetchCall[] = [];
const originalFetch = globalThis.fetch;
let nextSetResponseXml = "";
let nextGetResponseXml = "";
let getError: Error | null = null;

function stubFetch() {
  globalThis.fetch = (async (
    url: unknown,
    init?: { body?: unknown; headers?: Record<string, string> }
  ) => {
    const body = String(init?.body ?? "");
    const soapAction = init?.headers?.SOAPACTION;
    fetchCalls.push({ url: String(url), body, soapAction });
    const isSet = (soapAction ?? "").includes("SetBinaryState");
    if (!isSet && getError) {
      throw getError;
    }
    return {
      ok: true,
      status: 200,
      text: async () => (isSet ? nextSetResponseXml : nextGetResponseXml),
    } as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  fetchCalls.length = 0;
  nextSetResponseXml = "";
  nextGetResponseXml = "";
  getError = null;
  stubFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── Fixtures ───────────────────────────────────────────────────────────────

function soapResponse(action: string, innerXml: string): string {
  return `<?xml version="1.0"?>
    <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
      <s:Body>
        <u:${action}Response xmlns:u="urn:Belkin:service:basicevent:1">
          ${innerXml}
        </u:${action}Response>
      </s:Body>
    </s:Envelope>`;
}

const SET_WITH_STATE = soapResponse(
  "SetBinaryState",
  "<BinaryState>1</BinaryState><brightness>45</brightness>"
);
const SET_EMPTY = soapResponse("SetBinaryState", "");
const GET_DIFFERENT = soapResponse(
  "GetBinaryState",
  "<BinaryState>1</BinaryState><brightness>99</brightness>"
);

// ── Service setup ──────────────────────────────────────────────────────────

function makeService(savedType: WemoDeviceType, liveType: WemoDeviceType): DeviceService {
  const service = new DeviceService();
  const saved: SavedDevice = {
    id: "dimmer-1",
    name: "Test Dimmer",
    deviceType: savedType,
    host: "192.168.1.100",
    port: 49153,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  const live: WemoDevice = {
    id: "dimmer-1",
    name: "Test Dimmer",
    deviceType: liveType,
    host: "192.168.1.100",
    port: 49153,
    manufacturer: "Belkin",
    model: "Dimmer",
    serialNumber: "ABC123",
    firmwareVersion: "1.0",
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
  // Patch the seams: the saved record may be stale; the live discovered
  // device is the truth the brightness gate must follow.
  service.requireDevice = (_id: string) => saved;
  service.getDeviceClient = async (_device: SavedDevice) => new WemoDeviceClient(live);
  return service;
}

function captureStateChanged(service: DeviceService) {
  const events: Array<{ id: string; state: number; isOn: boolean; source: string }> = [];
  const unsub = service.events.on("stateChanged", (payload) => {
    events.push({
      id: payload.id,
      state: payload.state,
      isOn: payload.isOn,
      source: payload.source,
    });
  });
  return { events, unsub };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("DeviceService.setBrightness", () => {
  test("uses the Set reply state and skips the readback", async () => {
    const service = makeService(WemoDeviceType.Dimmer, WemoDeviceType.Dimmer);
    const { events, unsub } = captureStateChanged(service);
    nextSetResponseXml = SET_WITH_STATE;
    // A different polled state: if the service read back, this is what
    // it would report. It must not — the Set reply already confirmed 45.
    nextGetResponseXml = GET_DIFFERENT;

    const result = await service.setBrightness("dimmer-1", 60);

    expect(result.brightness).toBe(45);
    expect(result.state).toBe(1);
    expect(result.isOn).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.soapAction).toContain("SetBinaryState");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ id: "dimmer-1", state: 1, isOn: true, source: "api" });
    unsub();
  });

  test("stale saved type vs live type: a live Dimmer wins over a saved Switch", async () => {
    const service = makeService(WemoDeviceType.Switch, WemoDeviceType.Dimmer);
    const { events, unsub } = captureStateChanged(service);
    nextSetResponseXml = SET_WITH_STATE;

    const result = await service.setBrightness("dimmer-1", 60);

    expect(result.brightness).toBe(45);
    expect(events).toHaveLength(1);
    unsub();
  });

  test("stale saved type vs live type: a live Switch blocks a saved Dimmer", async () => {
    const service = makeService(WemoDeviceType.Dimmer, WemoDeviceType.Switch);
    nextSetResponseXml = SET_WITH_STATE;

    await expect(service.setBrightness("dimmer-1", 60)).rejects.toThrow(
      /does not support brightness control/
    );
    // The gate fires before any SOAP call.
    expect(fetchCalls).toHaveLength(0);
  });

  test("readback failure returns the sent level and emits no stateChanged", async () => {
    const service = makeService(WemoDeviceType.Dimmer, WemoDeviceType.Dimmer);
    const { events, unsub } = captureStateChanged(service);
    // The Set reply carries no state, so the service reads back — and
    // the readback fails. The acknowledged write still stands, but the
    // state is unconfirmed, so no event is emitted for Matter to trust.
    nextSetResponseXml = SET_EMPTY;
    getError = new Error("Connection refused");

    const result = await service.setBrightness("dimmer-1", 60);

    expect(result.brightness).toBe(60);
    expect(result.state).toBe(1);
    expect(result.isOn).toBe(true);
    expect(events).toHaveLength(0);
    expect(fetchCalls.some((c) => (c.soapAction ?? "").includes("GetBinaryState"))).toBe(true);
    unsub();
  });

  test("readback timeout returns the sent level and emits no stateChanged", async () => {
    const service = makeService(WemoDeviceType.Dimmer, WemoDeviceType.Dimmer);
    const { events, unsub } = captureStateChanged(service);
    nextSetResponseXml = SET_EMPTY;
    // A timeout is an unknown outcome, not a failed write: the device
    // may have applied the level. Same handling as a readback failure.
    getError = new DOMException("The operation was aborted.", "AbortError");

    const result = await service.setBrightness("dimmer-1", 60);

    expect(result.brightness).toBe(60);
    expect(result.state).toBe(1);
    expect(events).toHaveLength(0);
    unsub();
  });
});
