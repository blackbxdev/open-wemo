/**
 * Timer Schedule API Routes
 *
 * Endpoints for managing device timer/schedule rules.
 */

import { Hono } from "hono";
import { getDatabase } from "../../db";
import { getDeviceByAddress } from "../../wemo/discovery";
import { addTimer, deleteTimer, fetchTimers, toggleTimer, updateTimer } from "../../wemo/rules";
import type { SavedDevice } from "../../wemo/types";
import {
  DeviceNotFoundError,
  DeviceOfflineError,
  RulesFetchError,
  RulesStoreError,
  ValidationError,
} from "../errors";

/**
 * Timer routes - mounted under /api/devices/:id/timers
 */
export const timerRoutes = new Hono();

function requireParam(value: string | undefined, field: string): string {
  if (!value) {
    throw new ValidationError(`Missing route parameter: ${field}`, [field]);
  }
  return value;
}

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
 * Helper to get device UDN (for rules operations).
 * Attempts discovery to get the real UDN.
 */
async function getDeviceUdn(device: SavedDevice): Promise<string> {
  try {
    const wemoDevice = await getDeviceByAddress(device.host, device.port);
    if (!wemoDevice) {
      throw new DeviceOfflineError(device.id, "Device not reachable");
    }
    return wemoDevice.id;
  } catch (error) {
    if (error instanceof DeviceOfflineError) throw error;
    throw new DeviceOfflineError(device.id, "Device not reachable");
  }
}

/**
 * GET /api/devices/:id/timers
 *
 * Fetches all timer rules for a device.
 */
timerRoutes.get("/", async (c) => {
  const id = requireParam(c.req.param("id"), "id");
  const device = requireDevice(id);

  try {
    const schedule = await fetchTimers(device.host, device.port, device.id);
    return c.json({
      timers: schedule.rules,
      dbVersion: schedule.dbVersion,
    });
  } catch (error) {
    throw new RulesFetchError(id, error instanceof Error ? error.message : undefined);
  }
});

/**
 * POST /api/devices/:id/timers
 *
 * Creates a new timer rule.
 */
timerRoutes.post("/", async (c) => {
  const id = requireParam(c.req.param("id"), "id");
  const device = requireDevice(id);

  const body = await c.req.json<{
    name: string;
    startTime: number;
    startAction: number;
    dayId: number;
    endTime?: number;
    endAction?: number;
  }>();

  const missingFields: string[] = [];
  if (typeof body.name !== "string" || body.name.trim().length === 0) missingFields.push("name");
  if (typeof body.startTime !== "number") missingFields.push("startTime");
  if (typeof body.startAction !== "number") missingFields.push("startAction");
  if (typeof body.dayId !== "number") missingFields.push("dayId");

  if (missingFields.length > 0) {
    throw new ValidationError(
      `Missing or invalid required fields: ${missingFields.join(", ")}`,
      missingFields
    );
  }

  if (body.startTime < 0 || body.startTime > 86400) {
    throw new ValidationError("startTime must be between 0 and 86400", ["startTime"]);
  }

  if (![0, 1, 2].includes(body.startAction)) {
    throw new ValidationError("startAction must be 0, 1, or 2", ["startAction"]);
  }

  try {
    const udn = await getDeviceUdn(device);
    const rule = await addTimer(
      device.host,
      device.port,
      {
        name: body.name,
        startTime: body.startTime,
        endTime: body.endTime,
        startAction: body.startAction,
        endAction: body.endAction,
        dayId: body.dayId,
      },
      udn
    );
    return c.json({ timer: rule }, 201);
  } catch (error) {
    if (error instanceof DeviceOfflineError) throw error;
    throw new RulesStoreError(id, error instanceof Error ? error.message : undefined);
  }
});

/**
 * PATCH /api/devices/:id/timers/:ruleId
 *
 * Updates a timer rule.
 */
timerRoutes.patch("/:ruleId", async (c) => {
  const id = requireParam(c.req.param("id"), "id");
  const ruleId = requireParam(c.req.param("ruleId"), "ruleId");
  const ruleIdNum = Number(ruleId);
  if (!Number.isFinite(ruleIdNum)) {
    throw new ValidationError("ruleId must be a number", ["ruleId"]);
  }

  const device = requireDevice(id);
  const body = await c.req.json<{
    name?: string;
    startTime?: number;
    endTime?: number;
    startAction?: number;
    endAction?: number;
    dayId?: number;
    enabled?: boolean;
  }>();

  if (body.startTime !== undefined && (body.startTime < 0 || body.startTime > 86400)) {
    throw new ValidationError("startTime must be between 0 and 86400", ["startTime"]);
  }

  if (body.startAction !== undefined && ![0, 1, 2].includes(body.startAction)) {
    throw new ValidationError("startAction must be 0, 1, or 2", ["startAction"]);
  }

  try {
    const udn = await getDeviceUdn(device);
    const rule = await updateTimer(device.host, device.port, ruleIdNum, body, udn);
    return c.json({ timer: rule });
  } catch (error) {
    if (error instanceof DeviceOfflineError) throw error;
    throw new RulesStoreError(id, error instanceof Error ? error.message : undefined);
  }
});

/**
 * DELETE /api/devices/:id/timers/:ruleId
 *
 * Deletes a timer rule.
 */
timerRoutes.delete("/:ruleId", async (c) => {
  const id = requireParam(c.req.param("id"), "id");
  const ruleId = requireParam(c.req.param("ruleId"), "ruleId");
  const ruleIdNum = Number(ruleId);
  if (!Number.isFinite(ruleIdNum)) {
    throw new ValidationError("ruleId must be a number", ["ruleId"]);
  }

  const device = requireDevice(id);

  try {
    const udn = await getDeviceUdn(device);
    await deleteTimer(device.host, device.port, ruleIdNum, udn);
    return c.json({ deleted: true, ruleId: ruleIdNum });
  } catch (error) {
    if (error instanceof DeviceOfflineError) throw error;
    throw new RulesStoreError(id, error instanceof Error ? error.message : undefined);
  }
});

/**
 * PATCH /api/devices/:id/timers/:ruleId/toggle
 *
 * Toggles enabled state for a timer rule.
 */
timerRoutes.patch("/:ruleId/toggle", async (c) => {
  const id = requireParam(c.req.param("id"), "id");
  const ruleId = requireParam(c.req.param("ruleId"), "ruleId");
  const ruleIdNum = Number(ruleId);
  if (!Number.isFinite(ruleIdNum)) {
    throw new ValidationError("ruleId must be a number", ["ruleId"]);
  }

  const device = requireDevice(id);
  const body = await c.req.json<{ enabled: boolean }>();
  if (typeof body.enabled !== "boolean") {
    throw new ValidationError("enabled must be a boolean", ["enabled"]);
  }

  try {
    const udn = await getDeviceUdn(device);
    const rule = await toggleTimer(device.host, device.port, ruleIdNum, body.enabled, udn);
    return c.json({ timer: rule });
  } catch (error) {
    if (error instanceof DeviceOfflineError) throw error;
    throw new RulesStoreError(id, error instanceof Error ? error.message : undefined);
  }
});
