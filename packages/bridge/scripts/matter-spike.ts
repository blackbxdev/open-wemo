/**
 * Phase 0 spike: verify Matter bridge can start under Bun.
 * Run: bun scripts/matter-spike.ts
 * Decision: in-process Bun + @matter/nodejs is viable (see SUCCESS log).
 */

import "@matter/nodejs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Endpoint, Environment, ServerNode, VendorId } from "@matter/main";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors/bridged-device-basic-information";
import { OnOffPlugInUnitDevice } from "@matter/main/devices/on-off-plug-in-unit";
import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";

const storageDir = mkdtempSync(join(tmpdir(), "open-wemo-matter-spike-"));

async function main(): Promise<void> {
  console.log("[Spike] Storage:", storageDir);

  const env = Environment.default;
  env.vars.set("path.root", storageDir);

  const server = await ServerNode.create({
    id: "open-wemo-spike",
    network: { port: 5540 },
    commissioning: {
      passcode: 20202021,
      discriminator: 3840,
    },
    productDescription: {
      name: "Open Wemo Spike",
      deviceType: AggregatorEndpoint.deviceType,
    },
    basicInformation: {
      vendorName: "Open Wemo",
      vendorId: VendorId(0xfff1),
      nodeLabel: "Open Wemo Spike",
      productName: "Open Wemo Spike",
      productLabel: "Open Wemo Bridge",
      productId: 0x8000,
      serialNumber: "ow-spike-001",
      uniqueId: "open-wemo-spike-001",
    },
  });

  const aggregator = new Endpoint(AggregatorEndpoint, { id: "aggregator" });
  await server.add(aggregator);

  const plug = new Endpoint(OnOffPlugInUnitDevice.with(BridgedDeviceBasicInformationServer), {
    id: "test-plug",
    bridgedDeviceBasicInformation: {
      nodeLabel: "Spike Plug",
      productName: "Spike Plug",
      productLabel: "Spike Plug",
      serialNumber: "spike-plug-1",
      uniqueId: "spikeplug1",
      reachable: true,
    },
    onOff: { onOff: false },
  });
  await aggregator.add(plug);

  await server.start();

  const pairing = server.state.commissioning.pairingCodes;
  console.log("[Spike] Bridge started");
  console.log("[Spike] QR:", pairing.qrPairingCode);
  console.log("[Spike] Manual:", pairing.manualPairingCode);
  console.log("[Spike] Commissioned:", server.lifecycle.isCommissioned);

  await new Promise((r) => setTimeout(r, 2000));

  await server.close();
  console.log("[Spike] SUCCESS — Bun + matter.js in-process is viable");
  rmSync(storageDir, { recursive: true, force: true });
  process.exit(0);
}

main().catch((err) => {
  console.error("[Spike] FAILED:", err);
  try {
    rmSync(storageDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  process.exit(1);
});
