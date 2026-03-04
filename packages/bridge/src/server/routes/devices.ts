/**
 * Device CRUD API Routes
 *
 * Endpoints for managing saved devices.
 */

import { Hono } from "hono";
import { getDatabase } from "../../db";
import { WemoDeviceClient } from "../../wemo/device";
import { getDeviceByAddress } from "../../wemo/discovery";
import { InsightDeviceClient, supportsInsight } from "../../wemo/insight";
import { clearDeviceRules } from "../../wemo/scheduler";
import type { SavedDevice, WemoDeviceType } from "../../wemo/types";
import {
  DeviceNotFoundError,
  DeviceOfflineError,
  InsightNotSupportedError,
  ValidationError,
} from "../errors";

/**
 * Device routes.
 */
export const deviceRoutes = new Hono();

/**
 * Helper to get a saved device by ID, throwing if not found.
 */
function requireDevice(id: string): SavedDevice {
  const db = getDatabase();
  const device = db.getDeviceById(id);
  if (!device) {
    throw new DeviceNotFoundError(id);
  }
  return device;
}

/**
 * Helper to get a WemoDevice client from a SavedDevice.
 * Returns the client if device is reachable, throws otherwise.
 */
async function getDeviceClient(device: SavedDevice): Promise<WemoDeviceClient> {
  const wemoDevice = await getDeviceByAddress(device.host, device.port);
  if (!wemoDevice) {
    throw new DeviceOfflineError(device.id, "Device not reachable");
  }
  return new WemoDeviceClient(wemoDevice);
}

/**
 * Helper to get an Insight client from a SavedDevice.
 * Returns the client if device is reachable and supports Insight.
 */
async function getInsightClient(device: SavedDevice): Promise<InsightDeviceClient> {
  const wemoDevice = await getDeviceByAddress(device.host, device.port);
  if (!wemoDevice) {
    throw new DeviceOfflineError(device.id, "Device not reachable");
  }
  if (!supportsInsight(wemoDevice)) {
    throw new InsightNotSupportedError(device.id);
  }
  return new InsightDeviceClient(wemoDevice);
}

/** Device state result type */
type DeviceStateResult = {
  isOnline: boolean;
  state?: number;
  error?: string;
};

/**
 * Wraps a promise with a timeout.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * Helper to get device state safely with timeout.
 */
async function getDeviceState(device: SavedDevice): Promise<DeviceStateResult> {
  const offlineResult: DeviceStateResult = {
    isOnline: false,
    error: "Device not reachable (timeout)",
  };

  try {
    // Wrap the entire operation in a 6-second timeout
    return await withTimeout<DeviceStateResult>(
      (async (): Promise<DeviceStateResult> => {
        const client = await getDeviceClient(device);
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
 * GET /api/devices
 *
 * Lists all saved devices with optional state polling.
 *
 * Query Parameters:
 * - includeState: Whether to poll current state (default: false, slower)
 */
deviceRoutes.get("/", async (c) => {
  const includeState = c.req.query("includeState") === "true";
  const db = getDatabase();
  const devices = db.getAllDevices();

  if (!includeState) {
    return c.json({ devices });
  }

  // Poll state for each device (parallel)
  const devicesWithState = await Promise.all(
    devices.map(async (device) => {
      const status = await getDeviceState(device);
      return { ...device, ...status };
    })
  );

  return c.json({ devices: devicesWithState });
});

/**
 * GET /api/devices/:id
 *
 * Gets a single device by ID with current state.
 */
deviceRoutes.get("/:id", async (c) => {
  const device = requireDevice(c.req.param("id"));

  // Get current state
  const status = await getDeviceState(device);

  return c.json({
    device: { ...device, ...status },
  });
});

/**
 * POST /api/devices
 *
 * Adds or updates a device.
 *
 * Body:
 * {
 *   id?: string,      // Optional, will be generated if not provided
 *   name: string,
 *   host: string,
 *   port?: number,    // Default: 49153
 *   deviceType?: WemoDeviceType  // Default: "Switch"
 * }
 */
deviceRoutes.post("/", async (c) => {
  const body = await c.req.json<{
    id?: string;
    name: string;
    host: string;
    port?: number;
    deviceType?: WemoDeviceType;
  }>();

  const missingFields: string[] = [];
  if (!body.name) missingFields.push("name");
  if (!body.host) missingFields.push("host");

  if (missingFields.length > 0) {
    throw new ValidationError(
      `Missing required fields: ${missingFields.join(", ")}`,
      missingFields
    );
  }

  // Validate host is a valid IP address or hostname
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const hostnameRegex =
    /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

  if (!ipv4Regex.test(body.host) && !hostnameRegex.test(body.host)) {
    throw new ValidationError("Invalid host: must be a valid IP address or hostname", ["host"]);
  }

  // Additional IPv4 validation: each octet must be 0-255
  if (ipv4Regex.test(body.host)) {
    const octets = body.host.split(".").map(Number);
    if (octets.some((octet) => octet < 0 || octet > 255)) {
      throw new ValidationError("Invalid IP address: octets must be 0-255", ["host"]);
    }
  }

  // Validate port is in valid range
  if (body.port !== undefined) {
    if (!Number.isInteger(body.port) || body.port < 1 || body.port > 65535) {
      throw new ValidationError("Invalid port: must be an integer between 1 and 65535", ["port"]);
    }
  }

  const db = getDatabase();
  const now = new Date().toISOString();

  // Try to discover the device to get its real ID
  let deviceId = body.id;
  let deviceType = body.deviceType ?? ("Switch" as WemoDeviceType);

  if (!deviceId) {
    try {
      const discovered = await getDeviceByAddress(body.host, body.port ?? 49153);
      if (discovered) {
        deviceId = discovered.id;
        deviceType = discovered.deviceType;
      }
    } catch {
      // Ignore discovery errors, use provided or generated ID
    }
  }

  // Generate ID if still not set
  if (!deviceId) {
    deviceId = `manual:${body.host}:${body.port ?? 49153}`;
  }

  const device: SavedDevice = {
    id: deviceId,
    name: body.name,
    deviceType,
    host: body.host,
    port: body.port ?? 49153,
    createdAt: now,
    updatedAt: now,
  };

  db.saveDevice(device);

  return c.json({ device, created: true }, 201);
});

/**
 * PATCH /api/devices/:id
 *
 * Updates device properties.
 *
 * Body:
 * {
 *   name?: string,
 *   host?: string,
 *   port?: number
 * }
 */
deviceRoutes.patch("/:id", async (c) => {
  const existing = requireDevice(c.req.param("id"));

  const body = await c.req.json<{
    name?: string;
    host?: string;
    port?: number;
  }>();

  const db = getDatabase();
  const updated: SavedDevice = {
    ...existing,
    name: body.name ?? existing.name,
    host: body.host ?? existing.host,
    port: body.port ?? existing.port,
    updatedAt: new Date().toISOString(),
  };

  db.saveDevice(updated);

  return c.json({ device: updated });
});

/**
 * DELETE /api/devices/:id
 *
 * Removes a device from the database.
 */
deviceRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");

  // Verify device exists first
  requireDevice(id);

  const db = getDatabase();
  db.deleteDevice(id);
  clearDeviceRules(id);

  return c.json({ deleted: true, id });
});

// =============================================================================
// Device Control Endpoints
// =============================================================================

/**
 * GET /api/devices/:id/state
 *
 * Gets the current state of a device (lighter than full GET /:id).
 */
deviceRoutes.get("/:id/state", async (c) => {
  const device = requireDevice(c.req.param("id"));
  const client = await getDeviceClient(device);
  const state = await client.getBinaryState();

  return c.json({
    id: device.id,
    state,
    isOn: state === 1,
    isStandby: state === 8,
  });
});

/**
 * POST /api/devices/:id/on
 *
 * Turns the device on.
 */
deviceRoutes.post("/:id/on", async (c) => {
  const device = requireDevice(c.req.param("id"));
  const client = await getDeviceClient(device);
  await client.turnOn();
  const newState = await client.getBinaryState();

  return c.json({
    id: device.id,
    action: "on",
    state: newState,
    isOn: newState === 1,
  });
});

/**
 * POST /api/devices/:id/off
 *
 * Turns the device off.
 */
deviceRoutes.post("/:id/off", async (c) => {
  const device = requireDevice(c.req.param("id"));
  const client = await getDeviceClient(device);
  await client.turnOff();
  const newState = await client.getBinaryState();

  return c.json({
    id: device.id,
    action: "off",
    state: newState,
    isOn: newState === 1,
  });
});

/**
 * POST /api/devices/:id/toggle
 *
 * Toggles the device state.
 */
deviceRoutes.post("/:id/toggle", async (c) => {
  const device = requireDevice(c.req.param("id"));
  const client = await getDeviceClient(device);
  const { binaryState } = await client.toggle();

  return c.json({
    id: device.id,
    action: "toggle",
    state: binaryState,
    isOn: binaryState === 1,
  });
});

/**
 * GET /api/devices/:id/insight
 *
 * Gets power monitoring data for Insight devices.
 */
deviceRoutes.get("/:id/insight", async (c) => {
  const device = requireDevice(c.req.param("id"));
  const client = await getInsightClient(device);
  const powerData = await client.getPowerData();
  const rawParams = await client.getInsightParams();

  return c.json({
    id: device.id,
    power: powerData,
    raw: rawParams,
  });
});

deviceRoutes.get("/:id/threshold", async (c) => {
  const device = requireDevice(c.req.param("id"));
  const client = await getInsightClient(device);
  const thresholdMilliwatts = await client.getPowerThreshold();
  return c.json({
    id: device.id,
    thresholdWatts: thresholdMilliwatts / 1000,
    thresholdMilliwatts,
  });
});

deviceRoutes.put("/:id/threshold", async (c) => {
  const device = requireDevice(c.req.param("id"));
  const body = await c.req.json<{ watts?: unknown }>();

  if (
    typeof body.watts !== "number" ||
    !Number.isFinite(body.watts) ||
    body.watts < 0 ||
    body.watts > 50
  ) {
    throw new ValidationError("Invalid watts: must be a number between 0 and 50", ["watts"]);
  }

  const client = await getInsightClient(device);
  const milliwatts = Math.round(body.watts * 1000);
  await client.setPowerThreshold(milliwatts);

  return c.json({
    id: device.id,
    thresholdWatts: milliwatts / 1000,
    thresholdMilliwatts: milliwatts,
  });
});

deviceRoutes.post("/:id/threshold/reset", async (c) => {
  const device = requireDevice(c.req.param("id"));
  const client = await getInsightClient(device);
  await client.resetPowerThreshold();
  const confirmedMilliwatts = await client.getPowerThreshold();
  return c.json({
    id: device.id,
    thresholdWatts: confirmedMilliwatts / 1000,
    thresholdMilliwatts: confirmedMilliwatts,
  });
});
