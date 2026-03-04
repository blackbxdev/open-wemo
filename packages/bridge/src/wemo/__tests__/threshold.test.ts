import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockSoapRequest = mock(
  (): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> =>
    Promise.resolve({ success: true, data: {} })
);
mock.module("../soap", () => ({
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
  mockSoapRequest.mockClear();
  client = new InsightDeviceClient(createMockDevice());
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("InsightDeviceClient threshold methods", () => {
  describe("getPowerThreshold()", () => {
    test("calls soapRequest with correct parameters", async () => {
      mockSoapRequest.mockResolvedValueOnce({
        success: true,
        data: { PowerThreshold: "8000" },
      });

      await client.getPowerThreshold();

      expect(mockSoapRequest).toHaveBeenCalledWith(
        "192.168.1.100",
        49153,
        "/upnp/control/insight1",
        "urn:Belkin:service:insight:1",
        "GetPowerThreshold"
      );
    });

    test("returns number (milliwatts) from response", async () => {
      mockSoapRequest.mockResolvedValueOnce({
        success: true,
        data: { PowerThreshold: "5000" },
      });

      const result = await client.getPowerThreshold();

      expect(result).toBe(5000);
      expect(typeof result).toBe("number");
    });

    test("throws Error when response.success is false", async () => {
      mockSoapRequest.mockResolvedValueOnce({
        success: false,
        error: "Device unreachable",
      });

      await expect(client.getPowerThreshold()).rejects.toThrow(/failed to get.*powerthreshold/i);
    });

    test("returns 0 for empty/missing PowerThreshold field", async () => {
      mockSoapRequest.mockResolvedValueOnce({
        success: true,
        data: {},
      });

      const result = await client.getPowerThreshold();

      expect(result).toBe(0);
    });

    test("returns 0 for non-numeric PowerThreshold value", async () => {
      mockSoapRequest.mockResolvedValueOnce({
        success: true,
        data: { PowerThreshold: "notanumber" },
      });

      const result = await client.getPowerThreshold();

      expect(result).toBe(0);
    });
  });

  describe("setPowerThreshold()", () => {
    test("calls soapRequest with correct parameters and body", async () => {
      mockSoapRequest.mockResolvedValueOnce({
        success: true,
        data: {},
      });

      await client.setPowerThreshold(5000);

      expect(mockSoapRequest).toHaveBeenCalledWith(
        "192.168.1.100",
        49153,
        "/upnp/control/insight1",
        "urn:Belkin:service:insight:1",
        "SetPowerThreshold",
        "<PowerThreshold>5000</PowerThreshold>"
      );
    });

    test("uses correct service and controlURL", async () => {
      mockSoapRequest.mockResolvedValueOnce({
        success: true,
        data: {},
      });

      await client.setPowerThreshold(3000);

      const call = mockSoapRequest.mock.calls[0] as unknown as string[];
      expect(call[2]).toBe("/upnp/control/insight1");
      expect(call[3]).toBe("urn:Belkin:service:insight:1");
    });

    test("throws Error when response.success is false", async () => {
      mockSoapRequest.mockResolvedValueOnce({
        success: false,
        error: "Device busy",
      });

      await expect(client.setPowerThreshold(5000)).rejects.toThrow(
        /failed to set.*powerthreshold/i
      );
    });

    test("sends integer milliwatts in body", async () => {
      mockSoapRequest.mockResolvedValueOnce({
        success: true,
        data: {},
      });

      await client.setPowerThreshold(7500);

      const call = mockSoapRequest.mock.calls[0] as unknown as string[];
      expect(call[5]).toBe("<PowerThreshold>7500</PowerThreshold>");
    });
  });

  describe("resetPowerThreshold()", () => {
    test("calls soapRequest with ResetPowerThreshold action and 8000mW default", async () => {
      mockSoapRequest.mockResolvedValueOnce({
        success: true,
        data: {},
      });

      await client.resetPowerThreshold();

      expect(mockSoapRequest).toHaveBeenCalledWith(
        "192.168.1.100",
        49153,
        "/upnp/control/insight1",
        "urn:Belkin:service:insight:1",
        "ResetPowerThreshold",
        "<PowerThreshold>8000</PowerThreshold>"
      );
    });

    test("uses correct service and controlURL", async () => {
      mockSoapRequest.mockResolvedValueOnce({
        success: true,
        data: {},
      });

      await client.resetPowerThreshold();

      const call = mockSoapRequest.mock.calls[0] as unknown as string[];
      expect(call[2]).toBe("/upnp/control/insight1");
      expect(call[3]).toBe("urn:Belkin:service:insight:1");
    });

    test("throws Error when response.success is false", async () => {
      mockSoapRequest.mockResolvedValueOnce({
        success: false,
        error: "Connection timeout",
      });

      await expect(client.resetPowerThreshold()).rejects.toThrow(
        /failed to reset.*powerthreshold/i
      );
    });
  });
});
