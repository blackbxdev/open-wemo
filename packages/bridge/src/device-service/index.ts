/**
 * DeviceService — shared boundary between REST API and smart-home integrations.
 *
 * Wraps SQLite persistence + WeMo SOAP control so Matter (and future
 * integrations) do not duplicate device logic.
 */

import { getDatabase } from "../db";
import {
  DeviceNotFoundError,
  DeviceOfflineError,
  InsightNotSupportedError,
  ValidationError,
} from "../server/errors";
import { WemoDeviceClient } from "../wemo/device";
import { getDeviceByAddress } from "../wemo/discovery";
import { InsightDeviceClient, convertToPowerData, supportsInsight } from "../wemo/insight";
import {
  isKeepAliveEnabled,
  markManualOff,
  markManualOn,
  setKeepAliveEnabled,
} from "../wemo/keepalive";
import { fetchRulesDb, parseAllRulesFromDb } from "../wemo/rules";
import { clearDeviceRules } from "../wemo/scheduler";
import type { SavedDevice, WemoDeviceType } from "../wemo/types";
import { DeviceEventBus } from "./events";
import type { ControlResult, DeviceStateResult, DeviceWithState } from "./types";

export type {
  ControlResult,
  DeviceStateResult,
  DeviceWithState,
  DeviceServiceEventMap,
} from "./types";
export { DeviceEventBus } from "./events";

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * Central device lifecycle and control service.
 */
export class DeviceService {
  readonly events = new DeviceEventBus();

  /** Gets a saved device by ID, throwing if not found. */
  requireDevice(id: string): SavedDevice {
    const device = getDatabase().getDeviceById(id);
    if (!device) {
      throw new DeviceNotFoundError(id);
    }
    return device;
  }

  /** Lists all saved devices. */
  listDevices(): SavedDevice[] {
    return getDatabase().getAllDevices();
  }

  /** Lists devices with optional live state polling. */
  async listDevicesWithState(includeState: boolean): Promise<DeviceWithState[] | SavedDevice[]> {
    const devices = this.listDevices();
    if (!includeState) {
      return devices;
    }
    return Promise.all(
      devices.map(async (device) => {
        const status = await this.getState(device.id);
        return { ...device, ...status };
      })
    );
  }

  /** Gets a WeMo client for a saved device, throwing if offline. */
  async getDeviceClient(device: SavedDevice): Promise<WemoDeviceClient> {
    const wemoDevice = await getDeviceByAddress(device.host, device.port);
    if (!wemoDevice) {
      throw new DeviceOfflineError(device.id, "Device not reachable");
    }
    return new WemoDeviceClient(wemoDevice);
  }

  /** Gets an Insight client, throwing if offline or unsupported. */
  async getInsightClient(device: SavedDevice): Promise<InsightDeviceClient> {
    const wemoDevice = await getDeviceByAddress(device.host, device.port);
    if (!wemoDevice) {
      throw new DeviceOfflineError(device.id, "Device not reachable");
    }
    if (!supportsInsight(wemoDevice)) {
      throw new InsightNotSupportedError(device.id);
    }
    return new InsightDeviceClient(wemoDevice);
  }

  /** Polls binary state with a timeout (never throws for offline). */
  async getState(deviceId: string): Promise<DeviceStateResult> {
    const device = this.requireDevice(deviceId);
    const offlineResult: DeviceStateResult = {
      isOnline: false,
      error: "Device not reachable (timeout)",
    };

    try {
      return await withTimeout<DeviceStateResult>(
        (async (): Promise<DeviceStateResult> => {
          const client = await this.getDeviceClient(device);
          const binaryState = await client.getBinaryState();
          return { isOnline: true, state: binaryState };
        })(),
        6000,
        offlineResult
      );
    } catch (error) {
      return {
        isOnline: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Adds or updates a device in SQLite and emits lifecycle events.
   */
  async saveDevice(input: {
    id?: string;
    name: string;
    host: string;
    port?: number;
    deviceType?: WemoDeviceType;
  }): Promise<{ device: SavedDevice; created: boolean }> {
    const missingFields: string[] = [];
    if (!input.name) missingFields.push("name");
    if (!input.host) missingFields.push("host");
    if (missingFields.length > 0) {
      throw new ValidationError(
        `Missing required fields: ${missingFields.join(", ")}`,
        missingFields
      );
    }

    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const hostnameRegex =
      /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

    if (!ipv4Regex.test(input.host) && !hostnameRegex.test(input.host)) {
      throw new ValidationError("Invalid host: must be a valid IP address or hostname", ["host"]);
    }

    if (ipv4Regex.test(input.host)) {
      const octets = input.host.split(".").map(Number);
      if (octets.some((octet) => octet < 0 || octet > 255)) {
        throw new ValidationError("Invalid IP address: octets must be 0-255", ["host"]);
      }
    }

    if (input.port !== undefined) {
      if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
        throw new ValidationError("Invalid port: must be an integer between 1 and 65535", ["port"]);
      }
    }

    const db = getDatabase();
    const now = new Date().toISOString();
    let deviceId = input.id;
    let deviceType = input.deviceType ?? ("Switch" as WemoDeviceType);
    const existed = deviceId ? db.getDeviceById(deviceId) !== null : false;

    if (!deviceId) {
      try {
        const discovered = await getDeviceByAddress(input.host, input.port ?? 49153);
        if (discovered) {
          deviceId = discovered.id;
          deviceType = discovered.deviceType;
        }
      } catch {
        // Ignore discovery errors
      }
    }

    if (!deviceId) {
      deviceId = `manual:${input.host}:${input.port ?? 49153}`;
    }

    const wasExisting = existed || db.getDeviceById(deviceId) !== null;

    const device: SavedDevice = {
      id: deviceId,
      name: input.name,
      deviceType,
      host: input.host,
      port: input.port ?? 49153,
      createdAt: now,
      updatedAt: now,
    };

    // Preserve createdAt for updates
    if (wasExisting) {
      const existing = db.getDeviceById(deviceId);
      if (existing) {
        device.createdAt = existing.createdAt;
      }
    }

    db.saveDevice(device);

    if (wasExisting) {
      this.events.emit("deviceUpdated", device);
    } else {
      this.events.emit("deviceAdded", device);
    }

    return { device, created: !wasExisting };
  }

  /** Updates device properties and emits deviceUpdated. */
  updateDevice(id: string, updates: { name?: string; host?: string; port?: number }): SavedDevice {
    const existing = this.requireDevice(id);
    const updated: SavedDevice = {
      ...existing,
      name: updates.name ?? existing.name,
      host: updates.host ?? existing.host,
      port: updates.port ?? existing.port,
      updatedAt: new Date().toISOString(),
    };
    getDatabase().saveDevice(updated);
    this.events.emit("deviceUpdated", updated);
    return updated;
  }

  /**
   * Updates host/port after background discovery (IP change).
   * Emits deviceUpdated so Matter can refresh reachability metadata.
   */
  syncDeviceAddress(id: string, host: string, port: number): SavedDevice | null {
    const existing = getDatabase().getDeviceById(id);
    if (!existing) return null;
    if (existing.host === host && existing.port === port) {
      getDatabase().updateLastSeen(id);
      return existing;
    }
    const updated: SavedDevice = {
      ...existing,
      host,
      port,
      updatedAt: new Date().toISOString(),
    };
    getDatabase().saveDevice(updated);
    this.events.emit("deviceUpdated", updated);
    return updated;
  }

  /** Deletes a device and emits deviceRemoved. */
  deleteDevice(id: string): void {
    this.requireDevice(id);
    getDatabase().deleteDevice(id);
    clearDeviceRules(id);
    this.events.emit("deviceRemoved", { id });
  }

  /** Turns a device on. */
  async setOn(deviceId: string, source: "api" | "matter" = "api"): Promise<ControlResult> {
    const device = this.requireDevice(deviceId);
    const client = await this.getDeviceClient(device);
    await client.turnOn();
    markManualOn(device.id);
    const newState = await client.getBinaryState();
    const result: ControlResult = {
      id: device.id,
      action: "on",
      state: newState,
      isOn: newState === 1,
    };
    this.events.emit("stateChanged", {
      id: device.id,
      state: newState,
      isOn: result.isOn,
      source,
    });
    return result;
  }

  /** Turns a device off. */
  async setOff(deviceId: string, source: "api" | "matter" = "api"): Promise<ControlResult> {
    const device = this.requireDevice(deviceId);
    const client = await this.getDeviceClient(device);
    await client.turnOff();
    markManualOff(device.id);
    const newState = await client.getBinaryState();
    const result: ControlResult = {
      id: device.id,
      action: "off",
      state: newState,
      isOn: newState === 1,
    };
    this.events.emit("stateChanged", {
      id: device.id,
      state: newState,
      isOn: result.isOn,
      source,
    });
    return result;
  }

  /** Toggles a device. */
  async toggle(deviceId: string, source: "api" | "matter" = "api"): Promise<ControlResult> {
    const device = this.requireDevice(deviceId);
    const client = await this.getDeviceClient(device);
    const { binaryState } = await client.toggle();

    if (binaryState === 1) {
      markManualOn(device.id);
    } else {
      markManualOff(device.id);
    }

    const result: ControlResult = {
      id: device.id,
      action: "toggle",
      state: binaryState,
      isOn: binaryState === 1,
    };
    this.events.emit("stateChanged", {
      id: device.id,
      state: binaryState,
      isOn: result.isOn,
      source,
    });
    return result;
  }

  /** Gets binary state (throws if offline). */
  async getBinaryState(deviceId: string): Promise<{
    id: string;
    state: number;
    isOn: boolean;
    isStandby: boolean;
  }> {
    const device = this.requireDevice(deviceId);
    const client = await this.getDeviceClient(device);
    const state = await client.getBinaryState();
    return {
      id: device.id,
      state,
      isOn: state === 1,
      isStandby: state === 8,
    };
  }

  /** Insight power data. */
  async getInsight(deviceId: string) {
    const device = this.requireDevice(deviceId);
    const client = await this.getInsightClient(device);
    const powerData = await client.getPowerData();
    const rawParams = await client.getInsightParams();
    return { id: device.id, power: powerData, raw: rawParams };
  }

  async getThreshold(deviceId: string) {
    const device = this.requireDevice(deviceId);
    const client = await this.getInsightClient(device);
    const thresholdMilliwatts = await client.getPowerThreshold();
    return {
      id: device.id,
      thresholdWatts: thresholdMilliwatts / 1000,
      thresholdMilliwatts,
    };
  }

  async setThreshold(deviceId: string, watts: number) {
    if (typeof watts !== "number" || !Number.isFinite(watts) || watts < 0 || watts > 50) {
      throw new ValidationError("Invalid watts: must be a number between 0 and 50", ["watts"]);
    }
    const device = this.requireDevice(deviceId);
    const client = await this.getInsightClient(device);
    const milliwatts = Math.round(watts * 1000);
    await client.setPowerThreshold(milliwatts);
    return {
      id: device.id,
      thresholdWatts: milliwatts / 1000,
      thresholdMilliwatts: milliwatts,
    };
  }

  async resetThreshold(deviceId: string) {
    const device = this.requireDevice(deviceId);
    const client = await this.getInsightClient(device);
    await client.resetPowerThreshold();
    const confirmedMilliwatts = await client.getPowerThreshold();
    return {
      id: device.id,
      thresholdWatts: confirmedMilliwatts / 1000,
      thresholdMilliwatts: confirmedMilliwatts,
    };
  }

  getKeepAlive(deviceId: string) {
    const device = this.requireDevice(deviceId);
    return { id: device.id, enabled: isKeepAliveEnabled(device.id) };
  }

  async setKeepAlive(deviceId: string, enabled: boolean) {
    if (typeof enabled !== "boolean") {
      throw new ValidationError("Invalid enabled: must be a boolean", ["enabled"]);
    }
    const device = this.requireDevice(deviceId);
    setKeepAliveEnabled(device.id, enabled);

    if (device.deviceType === "Insight") {
      try {
        const client = await this.getInsightClient(device);
        const autoThresholdWatts = enabled ? 0 : 8;
        const displayThresholdMilliwatts = enabled ? 1 : 8000;
        await Promise.all([
          client.setAutoPowerThreshold(autoThresholdWatts),
          client.setPowerThreshold(displayThresholdMilliwatts),
        ]);

        if (enabled) {
          const state = await client.getBinaryState();
          if (state === 0 || state === 8) {
            markManualOff(device.id);
          }
        }

        console.log(
          `[KeepAlive] Set auto threshold to ${autoThresholdWatts}W, display threshold to ${displayThresholdMilliwatts}mW for "${device.name}"`
        );
      } catch (error) {
        console.error(
          `[KeepAlive] Failed to set power thresholds for "${device.name}":`,
          error instanceof Error ? error.message : error
        );
      }
    }

    return { id: device.id, enabled };
  }

  async getInsightDiagnostics(deviceId: string) {
    const device = this.requireDevice(deviceId);
    const client = await this.getInsightClient(device);

    const [insightParams, thresholdMilliwatts, rulesResult] = await Promise.all([
      client.getInsightParams(),
      client.getPowerThreshold(),
      fetchRulesDb(device.host, device.port),
    ]);

    const powerData = convertToPowerData(insightParams);
    const allRules = parseAllRulesFromDb(rulesResult.dbBuffer);
    const nonTimerRules = allRules.filter((r) => r.type !== "Timer");
    const stateLabels: Record<number, string> = { 0: "off", 1: "on", 8: "standby" };

    return {
      id: device.id,
      insight: {
        state: insightParams.state,
        stateLabel: stateLabels[insightParams.state] ?? "unknown",
        instantPowerMilliwatts: insightParams.instantPower,
        instantPowerWatts: insightParams.instantPower / 1000,
        reportedThresholdMilliwatts: insightParams.standbyThreshold,
        reportedThresholdWatts: insightParams.standbyThreshold / 1000,
        power: powerData,
      },
      threshold: {
        milliwatts: thresholdMilliwatts,
        watts: thresholdMilliwatts / 1000,
      },
      rules: {
        dbVersion: rulesResult.version,
        totalCount: allRules.length,
        timerCount: allRules.length - nonTimerRules.length,
        nonTimerCount: nonTimerRules.length,
        all: allRules,
      },
    };
  }
}

/** Singleton DeviceService. */
let instance: DeviceService | null = null;

export function getDeviceService(): DeviceService {
  if (!instance) {
    instance = new DeviceService();
  }
  return instance;
}

/** Reset singleton (tests). */
export function resetDeviceService(): void {
  instance?.events.removeAllListeners();
  instance = null;
}
