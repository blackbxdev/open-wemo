/**
 * WeMo Insight Device Support
 *
 * Extends the base device client with power monitoring capabilities
 * specific to WeMo Insight switches.
 */

import { WemoDeviceClient } from "./device";
import { extractNumericValue, extractTextValue, soapRequest } from "./soap";
import type { InsightParams, PowerData, WemoDevice } from "./types";

/**
 * Service type for Insight devices.
 */
const INSIGHT_SERVICE = "urn:Belkin:service:insight:1";

/**
 * Insight-specific control URL.
 */
const INSIGHT_CONTROL_URL = "/upnp/control/insight1";

/**
 * Parses the pipe-delimited InsightParams response from WeMo Insight devices.
 *
 * The response format is:
 * state|lastChange|onFor|onToday|onTotal|timePeriod|unknown|instantPower|todayEnergy|totalEnergy|unknown
 *
 * @param paramsString - The raw pipe-delimited string from GetInsightParams
 * @returns Parsed InsightParams object
 */
export function parseInsightParams(paramsString: string): InsightParams {
  const parts = paramsString.split("|");

  // Provide defaults for missing values
  const getValue = (index: number, defaultValue = 0): number => {
    const value = parts[index];
    if (value === undefined || value === "") return defaultValue;
    const num = Number.parseInt(value, 10);
    return Number.isNaN(num) ? defaultValue : num;
  };

  const state = getValue(0);

  return {
    state: (state === 0 || state === 8 ? state : 1) as 0 | 1 | 8,
    lastChange: getValue(1),
    onFor: getValue(2),
    onToday: getValue(3),
    onTotal: getValue(4),
    timePeriod: getValue(5),
    averagePower: getValue(6),
    instantPower: getValue(7),
    todayEnergy: getValue(8),
    totalEnergy: getValue(9),
    standbyThreshold: getValue(10, 8000), // Default 8W threshold
  };
}

/**
 * Formats seconds into a human-readable duration string.
 *
 * @param seconds - Duration in seconds
 * @returns Formatted string (e.g., "2h 30m", "45m 12s", "30s")
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    if (minutes > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${hours}h`;
  }

  if (secs > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${minutes}m`;
}

/**
 * Converts InsightParams to human-readable PowerData.
 *
 * @param params - Raw InsightParams from device
 * @returns Human-friendly PowerData object
 */
export function convertToPowerData(params: InsightParams): PowerData {
  return {
    isOn: params.state === 1,
    isStandby: params.state === 8,
    currentWatts: params.instantPower / 1000, // milliwatts to watts
    todayKwh: params.todayEnergy / 60000, // milliwatt-minutes to kWh
    totalKwh: params.totalEnergy / 60000, // milliwatt-minutes to kWh
    onForFormatted: formatDuration(params.onFor),
    onTodayFormatted: formatDuration(params.onToday),
  };
}

/**
 * Client for WeMo Insight devices with power monitoring support.
 *
 * Extends the base WemoDeviceClient with Insight-specific functionality.
 *
 * @example
 * ```ts
 * const device = await getDeviceByAddress("192.168.1.100");
 * const insight = new InsightDeviceClient(device);
 *
 * // Get raw insight params
 * const params = await insight.getInsightParams();
 * console.log(`Current power: ${params.instantPower}mW`);
 *
 * // Get human-friendly power data
 * const power = await insight.getPowerData();
 * console.log(`Current power: ${power.currentWatts}W`);
 * console.log(`Today: ${power.todayKwh}kWh`);
 * ```
 */
export class InsightDeviceClient extends WemoDeviceClient {
  /**
   * Gets the raw InsightParams from the device.
   *
   * @returns Raw InsightParams with values in device units (milliwatts, seconds, etc.)
   * @throws Error if device doesn't support Insight functionality
   */
  async getInsightParams(): Promise<InsightParams> {
    interface InsightResponse {
      InsightParams?: unknown;
    }

    const response = await soapRequest<InsightResponse>(
      this.host,
      this.port,
      INSIGHT_CONTROL_URL,
      INSIGHT_SERVICE,
      "GetInsightParams"
    );

    if (!response.success) {
      throw new Error(`Failed to get InsightParams: ${response.error}`);
    }

    const paramsString = extractTextValue(response.data?.InsightParams);
    if (!paramsString) {
      throw new Error("No InsightParams in response");
    }

    return parseInsightParams(paramsString);
  }

  async getPowerData(): Promise<PowerData> {
    const params = await this.getInsightParams();
    return convertToPowerData(params);
  }

  async getPowerThreshold(): Promise<number> {
    interface ThresholdResponse {
      PowerThreshold?: unknown;
    }

    const response = await soapRequest<ThresholdResponse>(
      this.host,
      this.port,
      INSIGHT_CONTROL_URL,
      INSIGHT_SERVICE,
      "GetPowerThreshold"
    );

    if (!response.success) {
      throw new Error(`Failed to get PowerThreshold: ${response.error}`);
    }

    return extractNumericValue(response.data?.PowerThreshold);
  }

  async setPowerThreshold(milliwatts: number): Promise<void> {
    const response = await soapRequest(
      this.host,
      this.port,
      INSIGHT_CONTROL_URL,
      INSIGHT_SERVICE,
      "SetPowerThreshold",
      `<PowerThreshold>${Math.round(milliwatts)}</PowerThreshold>`
    );

    if (!response.success) {
      throw new Error(`Failed to set PowerThreshold: ${response.error}`);
    }
  }

  async setAutoPowerThreshold(milliwatts: number): Promise<void> {
    const response = await soapRequest(
      this.host,
      this.port,
      INSIGHT_CONTROL_URL,
      INSIGHT_SERVICE,
      "SetAutoPowerThreshold",
      `<PowerThreshold>${Math.round(milliwatts)}</PowerThreshold>`
    );

    if (!response.success) {
      throw new Error(`Failed to set AutoPowerThreshold: ${response.error}`);
    }
  }

  async resetPowerThreshold(): Promise<void> {
    const response = await soapRequest(
      this.host,
      this.port,
      INSIGHT_CONTROL_URL,
      INSIGHT_SERVICE,
      "ResetPowerThreshold",
      "<PowerThreshold>8000</PowerThreshold>"
    );

    if (!response.success) {
      throw new Error(`Failed to reset PowerThreshold: ${response.error}`);
    }
  }

  get isInsightDevice(): boolean {
    return this.info.deviceType === "Insight";
  }
}

/**
 * Creates an Insight device client from a WemoDevice object.
 *
 * @param device - The WemoDevice to create a client for
 * @returns A new InsightDeviceClient instance
 */
export function createInsightClient(device: WemoDevice): InsightDeviceClient {
  return new InsightDeviceClient(device);
}

/**
 * Checks if a device supports Insight power monitoring.
 *
 * @param device - The device to check
 * @returns true if device supports Insight features
 */
export function supportsInsight(device: WemoDevice): boolean {
  return device.deviceType === "Insight";
}
