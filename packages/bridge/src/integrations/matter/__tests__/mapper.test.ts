import { describe, expect, test } from "bun:test";
import { WemoDeviceType } from "../../../wemo/types";
import {
  mapWemoTypeToMatter,
  resolveMatterKind,
  toMatterEndpointId,
  toMatterUniqueId,
} from "../mapper";

describe("mapWemoTypeToMatter", () => {
  test("maps plugs and switches to plug", () => {
    expect(mapWemoTypeToMatter(WemoDeviceType.Switch)).toBe("plug");
    expect(mapWemoTypeToMatter(WemoDeviceType.Mini)).toBe("plug");
    expect(mapWemoTypeToMatter(WemoDeviceType.Insight)).toBe("plug");
  });

  test("maps lights and dimmers to light", () => {
    expect(mapWemoTypeToMatter(WemoDeviceType.LightSwitch)).toBe("light");
    expect(mapWemoTypeToMatter(WemoDeviceType.Bulb)).toBe("light");
    expect(mapWemoTypeToMatter(WemoDeviceType.Dimmer)).toBe("light");
  });

  test("defaults Unknown and unrecognized types to plug for on/off", () => {
    expect(mapWemoTypeToMatter(WemoDeviceType.Unknown)).toBe("plug");
    expect(mapWemoTypeToMatter("SomethingElse")).toBe("plug");
  });

  test("skips motion only", () => {
    expect(mapWemoTypeToMatter(WemoDeviceType.Motion)).toBe("skip");
  });
});

describe("resolveMatterKind", () => {
  test("uses automatic mapping when no override", () => {
    const resolved = resolveMatterKind(WemoDeviceType.Switch);
    expect(resolved).toEqual({ kind: "plug", autoKind: "plug", source: "auto" });
  });

  test("Unknown auto-maps to plug", () => {
    const resolved = resolveMatterKind(WemoDeviceType.Unknown);
    expect(resolved.kind).toBe("plug");
    expect(resolved.source).toBe("auto");
  });

  test("override wins over automatic mapping", () => {
    const resolved = resolveMatterKind(WemoDeviceType.Switch, "light");
    expect(resolved).toEqual({ kind: "light", autoKind: "plug", source: "override" });
  });

  test("null or invalid override falls back to auto", () => {
    expect(resolveMatterKind(WemoDeviceType.Dimmer, null).source).toBe("auto");
    expect(resolveMatterKind(WemoDeviceType.Dimmer, undefined).kind).toBe("light");
  });
});

describe("toMatterEndpointId", () => {
  test("sanitizes special characters", () => {
    expect(toMatterEndpointId("uuid:Socket-1_0-ABC")).toBe("uuid_Socket-1_0-ABC");
  });

  test("handles empty-like input", () => {
    const id = toMatterEndpointId("!!!");
    expect(id.startsWith("device_")).toBe(true);
  });
});

describe("toMatterUniqueId", () => {
  test("strips non-alphanumeric", () => {
    expect(toMatterUniqueId("uuid:Socket-1")).toBe("uuidSocket1");
  });
});
