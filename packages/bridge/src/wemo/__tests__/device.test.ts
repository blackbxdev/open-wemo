/**
 * Tests for WemoDeviceClient brightness control.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── Mocks ──────────────────────────────────────────────────────────────────────

type SoapCall = { action: string; body?: string };
const calls: SoapCall[] = [];
let nextData: Record<string, unknown> = {};

const mockSoapRequest = mock(
  async (
    _host: string,
    _port: number,
    _controlURL: string,
    _serviceType: string,
    action: string,
    body?: string
  ): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> => {
    calls.push({ action, body });
    return { success: true, data: nextData };
  }
);
mock.module("../soap", () => ({
  soapRequest: mockSoapRequest,
  extractNumericValue: (value: unknown): number | undefined => {
    if (typeof value === "number") return Number.isNaN(value) ? undefined : value;
    if (typeof value === "string") {
      const num = Number(value);
      return Number.isNaN(num) ? undefined : num;
    }
    return undefined;
  },
  extractTextValue: (value: unknown): string => {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    return "";
  },
}));

// ── Setup ──────────────────────────────────────────────────────────────────────

import { WemoDeviceClient } from "../device";
import { WemoDeviceType } from "../types";
import type { WemoDevice } from "../types";

function createMockDimmer(): WemoDevice {
  return {
    id: "test-dimmer-001",
    name: "Test Dimmer",
    deviceType: WemoDeviceType.Dimmer,
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
  calls.length = 0;
  nextData = { BinaryState: 1, brightness: 50 };
  client = new WemoDeviceClient(createMockDimmer());
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("WemoDeviceClient brightness", () => {
  describe("setBrightness()", () => {
    test("sends SetBinaryState with brightness for a level", async () => {
      await client.setBrightness(75);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.action).toBe("SetBinaryState");
      expect(calls[0]?.body).toContain("<BinaryState>1</BinaryState>");
      expect(calls[0]?.body).toContain("<brightness>75</brightness>");
    });

    test("clamps levels above 100", async () => {
      await client.setBrightness(150);
      expect(calls[0]?.body).toContain("<brightness>100</brightness>");
    });

    test("clamps negative levels to 0 and turns off", async () => {
      await client.setBrightness(-10);
      expect(calls[0]?.body).toContain("<BinaryState>0</BinaryState>");
      expect(calls[0]?.body).not.toContain("brightness");
    });

    test("level 0 turns the device off without a brightness element", async () => {
      await client.setBrightness(0);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.body).toBe("<BinaryState>0</BinaryState>");
    });

    test("rounds fractional levels", async () => {
      await client.setBrightness(42.6);
      expect(calls[0]?.body).toContain("<brightness>43</brightness>");
    });
  });

  describe("getBrightness()", () => {
    test("returns the brightness reported by the device", async () => {
      nextData = { BinaryState: 1, brightness: 50 };
      await expect(client.getBrightness()).resolves.toBe(50);
    });

    test("returns undefined when the device reports no brightness", async () => {
      nextData = { BinaryState: 1 };
      await expect(client.getBrightness()).resolves.toBeUndefined();
    });
  });

  describe("getState()", () => {
    test("includes brightness for dimmable devices", async () => {
      nextData = { BinaryState: 1, brightness: 50 };
      const state = await client.getState();
      expect(state.binaryState).toBe(1);
      expect(state.brightness).toBe(50);
    });

    test("omits brightness when the device does not report one", async () => {
      nextData = { BinaryState: 0 };
      const state = await client.getState();
      expect(state.binaryState).toBe(0);
      expect(state.brightness).toBeUndefined();
    });
  });
});
