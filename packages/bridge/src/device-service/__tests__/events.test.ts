import { describe, expect, test } from "bun:test";
import type { SavedDevice } from "../../wemo/types";
import { WemoDeviceType } from "../../wemo/types";
import { DeviceEventBus } from "../events";

describe("DeviceEventBus", () => {
  test("delivers typed events to subscribers", () => {
    const bus = new DeviceEventBus();
    const received: SavedDevice[] = [];

    const unsub = bus.on("deviceAdded", (device) => {
      received.push(device);
    });

    const device: SavedDevice = {
      id: "d1",
      name: "Lamp",
      deviceType: WemoDeviceType.Switch,
      host: "192.168.1.10",
      port: 49153,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    bus.emit("deviceAdded", device);
    expect(received).toHaveLength(1);
    expect(received[0]?.id).toBe("d1");

    unsub();
    bus.emit("deviceAdded", device);
    expect(received).toHaveLength(1);
  });

  test("stateChanged carries source", () => {
    const bus = new DeviceEventBus();
    let source = "";
    bus.on("stateChanged", (payload) => {
      source = payload.source;
    });
    bus.emit("stateChanged", { id: "x", state: 1, isOn: true, source: "api" });
    expect(source).toBe("api");
  });
});
