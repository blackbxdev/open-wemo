/**
 * Optional per-device Matter kind overrides (SQLite settings).
 */

import { getDatabase } from "../../db";
import type { MatterDeviceKind } from "./mapper";

export const MATTER_DEVICE_KINDS_SETTING = "matter_device_kinds";

type KindMap = Record<string, MatterDeviceKind>;

function isMatterKind(value: unknown): value is MatterDeviceKind {
  return value === "plug" || value === "light" || value === "skip";
}

/**
 * Loads the override map from settings. Invalid entries are ignored.
 */
export function getKindOverrides(): KindMap {
  const raw = getDatabase().getSetting(MATTER_DEVICE_KINDS_SETTING);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const result: KindMap = {};
    for (const [id, kind] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof id === "string" && id.length > 0 && isMatterKind(kind)) {
        result[id] = kind;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function saveKindOverrides(map: KindMap): void {
  getDatabase().setSetting(MATTER_DEVICE_KINDS_SETTING, JSON.stringify(map));
}

/**
 * Returns the override for a device, or null if none.
 */
export function getKindOverride(deviceId: string): MatterDeviceKind | null {
  return getKindOverrides()[deviceId] ?? null;
}

/**
 * Sets or clears a per-device Matter kind override.
 * Pass null to clear and fall back to automatic mapping.
 */
export function setKindOverride(deviceId: string, kind: MatterDeviceKind | null): void {
  const map = getKindOverrides();
  if (kind === null) {
    delete map[deviceId];
  } else if (!isMatterKind(kind)) {
    throw new Error(`Invalid Matter kind: ${String(kind)}`);
  } else {
    map[deviceId] = kind;
  }
  saveKindOverrides(map);
}
