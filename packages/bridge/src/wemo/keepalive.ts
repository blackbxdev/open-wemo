import { getDatabase } from "../db";
import { soapRequest } from "./soap";
import type { SavedDevice } from "./types";

const KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const SETTINGS_PREFIX = "keepalive:";

const manuallyOff = new Set<string>();

function settingsKey(deviceId: string): string {
  return `${SETTINGS_PREFIX}${deviceId}`;
}

export function isKeepAliveEnabled(deviceId: string): boolean {
  return getDatabase().getBoolSetting(settingsKey(deviceId), false);
}

export function setKeepAliveEnabled(deviceId: string, enabled: boolean): void {
  getDatabase().setBoolSetting(settingsKey(deviceId), enabled);
  if (enabled) {
    manuallyOff.delete(deviceId);
  }
}

export function markManualOff(deviceId: string): void {
  manuallyOff.add(deviceId);
}

export function markManualOn(deviceId: string): void {
  manuallyOff.delete(deviceId);
}

async function sendOn(device: SavedDevice): Promise<void> {
  await soapRequest(
    device.host,
    device.port,
    "/upnp/control/basicevent1",
    "urn:Belkin:service:basicevent:1",
    "SetBinaryState",
    "<BinaryState>1</BinaryState>"
  );
}

async function getInsightState(device: SavedDevice): Promise<number> {
  interface InsightResponse {
    InsightParams?: unknown;
  }
  const response = await soapRequest<InsightResponse>(
    device.host,
    device.port,
    "/upnp/control/insight1",
    "urn:Belkin:service:insight:1",
    "GetInsightParams"
  );
  if (!response.success || !response.data?.InsightParams) {
    return -1;
  }
  const raw = String(response.data.InsightParams);
  const firstField = raw.split("|")[0] ?? "";
  const state = Number.parseInt(firstField, 10);
  return Number.isNaN(state) ? -1 : state;
}

async function tickDevice(device: SavedDevice): Promise<void> {
  if (manuallyOff.has(device.id)) return;
  if (device.deviceType !== "Insight") return;

  try {
    const state = await getInsightState(device);
    // state 8 = standby (relay on but firmware may auto-kill soon)
    // state 0 = off (firmware already killed it)
    if (state === 8 || state === 0) {
      await sendOn(device);
      console.log(
        `[KeepAlive] Revived device "${device.name}" (was ${state === 0 ? "off" : "standby"})`
      );
    }
  } catch (error) {
    console.error(
      `[KeepAlive] Failed to check/revive "${device.name}":`,
      error instanceof Error ? error.message : error
    );
  }
}

async function tick(): Promise<void> {
  const db = getDatabase();
  const devices = db.getAllDevices();

  for (const device of devices) {
    if (!isKeepAliveEnabled(device.id)) continue;
    await tickDevice(device);
  }
}

export function startKeepAlive(): { stop: () => void } {
  const intervalId = setInterval(() => {
    tick().catch((error) => {
      console.error("[KeepAlive] Tick error:", error);
    });
  }, KEEPALIVE_INTERVAL_MS);

  // Run initial tick after short delay (let devices settle after startup)
  const initialTimeout = setTimeout(() => {
    tick().catch((error) => {
      console.error("[KeepAlive] Initial tick error:", error);
    });
  }, 10_000);

  console.log("[KeepAlive] Started (5-minute interval)");

  return {
    stop: () => {
      clearInterval(intervalId);
      clearTimeout(initialTimeout);
      console.log("[KeepAlive] Stopped");
    },
  };
}

export function _resetForTesting(): void {
  manuallyOff.clear();
}
