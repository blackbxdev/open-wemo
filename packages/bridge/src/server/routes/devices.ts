/**
 * Device CRUD API Routes
 *
 * Thin wrappers over DeviceService.
 */

import { Hono } from "hono";
import { getDeviceService } from "../../device-service";
import type { WemoDeviceType } from "../../wemo/types";
import { ValidationError } from "../errors";

/**
 * Device routes.
 */
export const deviceRoutes = new Hono();

/**
 * GET /api/devices
 */
deviceRoutes.get("/", async (c) => {
  const includeState = c.req.query("includeState") === "true";
  const devices = await getDeviceService().listDevicesWithState(includeState);
  return c.json({ devices });
});

/**
 * GET /api/devices/:id
 */
deviceRoutes.get("/:id", async (c) => {
  const svc = getDeviceService();
  const device = svc.requireDevice(c.req.param("id"));
  const status = await svc.getState(device.id);
  return c.json({
    device: { ...device, ...status },
  });
});

/**
 * POST /api/devices
 */
deviceRoutes.post("/", async (c) => {
  const body = await c.req.json<{
    id?: string;
    name: string;
    host: string;
    port?: number;
    deviceType?: WemoDeviceType;
  }>();

  const { device, created } = await getDeviceService().saveDevice(body);
  return c.json({ device, created }, 201);
});

/**
 * PATCH /api/devices/:id
 */
deviceRoutes.patch("/:id", async (c) => {
  const body = await c.req.json<{
    name?: string;
    host?: string;
    port?: number;
  }>();

  const device = getDeviceService().updateDevice(c.req.param("id"), body);
  return c.json({ device });
});

/**
 * DELETE /api/devices/:id
 */
deviceRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  getDeviceService().deleteDevice(id);
  return c.json({ deleted: true, id });
});

// =============================================================================
// Device Control Endpoints
// =============================================================================

deviceRoutes.get("/:id/state", async (c) => {
  const result = await getDeviceService().getBinaryState(c.req.param("id"));
  return c.json(result);
});

deviceRoutes.post("/:id/on", async (c) => {
  const result = await getDeviceService().setOn(c.req.param("id"), "api");
  return c.json(result);
});

deviceRoutes.post("/:id/off", async (c) => {
  const result = await getDeviceService().setOff(c.req.param("id"), "api");
  return c.json(result);
});

deviceRoutes.post("/:id/toggle", async (c) => {
  const result = await getDeviceService().toggle(c.req.param("id"), "api");
  return c.json(result);
});

deviceRoutes.get("/:id/insight", async (c) => {
  const result = await getDeviceService().getInsight(c.req.param("id"));
  return c.json(result);
});

deviceRoutes.get("/:id/threshold", async (c) => {
  const result = await getDeviceService().getThreshold(c.req.param("id"));
  return c.json(result);
});

deviceRoutes.put("/:id/threshold", async (c) => {
  const body = await c.req.json<{ watts?: unknown }>();
  const result = await getDeviceService().setThreshold(c.req.param("id"), body.watts as number);
  return c.json(result);
});

deviceRoutes.post("/:id/threshold/reset", async (c) => {
  const result = await getDeviceService().resetThreshold(c.req.param("id"));
  return c.json(result);
});

// =============================================================================
// Keep-Alive
// =============================================================================

deviceRoutes.get("/:id/keepalive", (c) => {
  return c.json(getDeviceService().getKeepAlive(c.req.param("id")));
});

deviceRoutes.put("/:id/keepalive", async (c) => {
  const body = await c.req.json<{ enabled?: unknown }>();
  if (typeof body.enabled !== "boolean") {
    throw new ValidationError("Invalid enabled: must be a boolean", ["enabled"]);
  }
  const result = await getDeviceService().setKeepAlive(c.req.param("id"), body.enabled);
  return c.json(result);
});

// =============================================================================
// Insight Diagnostics
// =============================================================================

deviceRoutes.get("/:id/insight/diagnostics", async (c) => {
  const result = await getDeviceService().getInsightDiagnostics(c.req.param("id"));
  return c.json(result);
});
