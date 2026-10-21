/**
 * Matter integration API routes.
 */

import { Hono } from "hono";
import { getIntegrationManager } from "../../integrations";
import { generateMatterPageHtml } from "../../integrations/matter/commissioning";
import type { MatterDeviceKind } from "../../integrations/matter/mapper";
import { ValidationError } from "../errors";

export const matterRoutes = new Hono();

function parseMatterKind(value: unknown): MatterDeviceKind | null {
  if (value === null) {
    return null;
  }
  if (value === "plug" || value === "light" || value === "skip") {
    return value;
  }
  throw new ValidationError('kind must be "plug", "light", "skip", or null', ["kind"]);
}

/**
 * Parses a vendor/product ID given as a number or hex string ("0xFFF1").
 */
export function parseId(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const parsed = trimmed.toLowerCase().startsWith("0x")
      ? Number.parseInt(trimmed.slice(2), 16)
      : Number.parseInt(trimmed, 10);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }
  throw new ValidationError(`Invalid ${field}: must be a number or hex string like 0xFFF1`, [
    field,
  ]);
}

/**
 * GET /api/integrations/matter/status
 */
matterRoutes.get("/status", (c) => {
  const mgr = getIntegrationManager();
  return c.json({
    enabled: mgr.isMatterEnabled(),
    ...mgr.getMatterStatus(),
  });
});

/**
 * POST /api/integrations/matter/enable
 */
matterRoutes.post("/enable", async (c) => {
  const status = await getIntegrationManager().enableMatter();
  return c.json({ enabled: true, ...status });
});

/**
 * POST /api/integrations/matter/disable
 */
matterRoutes.post("/disable", async (c) => {
  const status = await getIntegrationManager().disableMatter();
  return c.json({ enabled: false, ...status });
});

/**
 * POST /api/integrations/matter/reset
 *
 * Clears commissioned fabrics so the bridge can be paired again.
 */
matterRoutes.post("/reset", async (c) => {
  const mgr = getIntegrationManager();
  const status = await mgr.resetMatterCommissioning();
  return c.json({ reset: true, enabled: mgr.isMatterEnabled(), ...status });
});

/**
 * PUT /api/integrations/matter/identity
 *
 * Sets the advertised vendor/product IDs. These must match the Matter
 * integration registered in the Google Home Developer Console.
 */
matterRoutes.put("/identity", async (c) => {
  const body = await c.req.json<{ vendorId?: unknown; productId?: unknown }>();
  const vendorId = parseId(body.vendorId, "vendorId");
  const productId = parseId(body.productId, "productId");

  const mgr = getIntegrationManager();
  try {
    const status = await mgr.setMatterIdentity(vendorId, productId);
    return c.json({ enabled: mgr.isMatterEnabled(), ...status });
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : "Invalid Matter identity", [
      "vendorId",
      "productId",
    ]);
  }
});

/**
 * PUT /api/integrations/matter/devices/:id/kind
 *
 * Sets or clears a per-device Matter kind override.
 * Body: { "kind": "plug" | "light" | "skip" | null }
 */
matterRoutes.put("/devices/:id/kind", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ kind?: unknown }>();
  const kind = parseMatterKind(body.kind);

  const mgr = getIntegrationManager();
  try {
    const status = await mgr.setDeviceKind(id, kind);
    return c.json({ enabled: mgr.isMatterEnabled(), ...status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to set Matter kind";
    if (message.startsWith("Device not found")) {
      return c.json({ error: true, code: "NOT_FOUND", message }, 404);
    }
    throw new ValidationError(message, ["kind"]);
  }
});

/**
 * GET /api/integrations/matter/pairing
 */
matterRoutes.get("/pairing", (c) => {
  const mgr = getIntegrationManager();
  const status = mgr.getMatterStatus();
  if (!mgr.isMatterEnabled() || !status.pairing) {
    return c.json(
      {
        error: true,
        code: "MATTER_NOT_RUNNING",
        message: "Matter bridge is not enabled or not running",
      },
      503
    );
  }
  return c.json({
    enabled: true,
    ...status.pairing,
    deviceCount: status.deviceCount,
  });
});

/**
 * Serves the Matter commissioning HTML page (used from server/index).
 */
export async function renderMatterPage(): Promise<string> {
  const mgr = getIntegrationManager();
  const status = mgr.getMatterStatus();
  return generateMatterPageHtml({
    enabled: mgr.isMatterEnabled(),
    running: status.running,
    pairing: status.pairing,
    error: status.error,
    deviceCount: status.deviceCount,
    identity: status.identity,
  });
}
