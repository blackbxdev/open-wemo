/**
 * Maps WeMo device types to Matter endpoint kinds.
 *
 * Controllers (especially Google Home) choose UI controls from the Matter
 * device type ID. We only use actuator types with an OnOff cluster:
 * On/Off Plug-in Unit and On/Off Light — never On/Off Light Switch (0x0103),
 * which Google treats as a controller with no on/off UI.
 */

import { WemoDeviceType } from "../../wemo/types";

/** Matter device kind used when creating bridged endpoints. */
export type MatterDeviceKind = "plug" | "light" | "skip";

export type MatterKindSource = "auto" | "override";

export interface ResolvedMatterKind {
  kind: MatterDeviceKind;
  /** Kind from WeMo type alone (before override). */
  autoKind: MatterDeviceKind;
  source: MatterKindSource;
}

/**
 * Returns the automatic Matter endpoint kind for a WeMo device type.
 *
 * Unknown defaults to plug so devices still get on/off in controllers.
 * Motion is skipped (no on/off actuator).
 */
export function mapWemoTypeToMatter(deviceType: WemoDeviceType | string): MatterDeviceKind {
  switch (deviceType) {
    case WemoDeviceType.Switch:
    case WemoDeviceType.Mini:
    case WemoDeviceType.Insight:
    case WemoDeviceType.Unknown:
      return "plug";
    case WemoDeviceType.LightSwitch:
    case WemoDeviceType.Bulb:
    case WemoDeviceType.Dimmer:
      // Dimmer maps to on/off light until brightness is implemented
      return "light";
    case WemoDeviceType.Motion:
      return "skip";
    default:
      // Future / unrecognized types: prefer on/off over dropping the device
      return "plug";
  }
}

/**
 * Resolves the effective Matter kind for a device.
 *
 * Priority: user override → automatic map from WeMo type.
 */
export function resolveMatterKind(
  deviceType: WemoDeviceType | string,
  override?: MatterDeviceKind | null
): ResolvedMatterKind {
  const autoKind = mapWemoTypeToMatter(deviceType);
  if (override === "plug" || override === "light" || override === "skip") {
    return { kind: override, autoKind, source: "override" };
  }
  return { kind: autoKind, autoKind, source: "auto" };
}

/**
 * Sanitizes a WeMo device ID into a Matter-safe endpoint id / uniqueId fragment.
 * Matter uniqueId should be alphanumeric and reasonably short.
 */
export function toMatterEndpointId(deviceId: string): string {
  // Keep readable prefix; strip characters that break endpoint ids
  const cleaned = deviceId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  // Reject empty or punctuation-only results
  if (/[a-zA-Z0-9]/.test(cleaned)) {
    return cleaned;
  }
  return `device_${hashString(deviceId)}`;
}

/**
 * Creates a Matter uniqueId (alphanumeric, no hyphens preferred for some controllers).
 */
export function toMatterUniqueId(deviceId: string): string {
  return deviceId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32) || `ow${hashString(deviceId)}`;
}

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}
