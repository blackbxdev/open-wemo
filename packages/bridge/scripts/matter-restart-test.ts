/**
 * Reproduction: start → stop → start a Matter ServerNode twice in one process.
 *
 * The bridge restarts the Matter node when the user resets pairing or changes
 * the vendor/product ID, so this must work without recreating the process.
 *
 * Usage: bun scripts/matter-restart-test.ts [--shared-env]
 */

import "@matter/nodejs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Endpoint, Environment, ServerNode, StorageService, VendorId } from "@matter/main";
import { OnOffPlugInUnitDevice } from "@matter/main/devices/on-off-plug-in-unit";
import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";

const useSharedEnv = process.argv.includes("--shared-env");
const driverArg = process.argv.find((a) => a.startsWith("--driver="));
const driver = driverArg?.split("=")[1];
const storageDir = mkdtempSync(join(tmpdir(), "open-wemo-matter-restart-"));
const PORT = 5541;

async function startNode(attempt: number): Promise<ServerNode> {
  const environment = useSharedEnv
    ? Environment.default
    : new Environment(`open-wemo-${attempt}`, Environment.default);
  environment.vars.set("path.root", storageDir);

  if (driver) {
    const storage = environment.get(StorageService);
    storage.configuredDriver = driver;
    storage.configuredBlobDriver = driver;
  }

  const server = await ServerNode.create({
    environment,
    id: "open-wemo",
    network: { port: PORT },
    commissioning: { passcode: 20202021, discriminator: 3840 },
    productDescription: { name: "Open Wemo", deviceType: AggregatorEndpoint.deviceType },
    basicInformation: {
      vendorName: "Open Wemo",
      vendorId: VendorId(0xfff1),
      nodeLabel: "Open Wemo",
      productName: "Open Wemo Bridge",
      productLabel: "WeMo Matter Bridge",
      productId: 0x8001,
      serialNumber: "restart-test",
      uniqueId: "restarttest001",
    },
  });

  const aggregator = new Endpoint(AggregatorEndpoint, { id: "aggregator" });
  await server.add(aggregator);

  const plug = new Endpoint(OnOffPlugInUnitDevice, { id: "plug1", onOff: { onOff: false } });
  await aggregator.add(plug);

  await server.start();
  return server;
}

async function main(): Promise<void> {
  console.log(
    `[Restart] env mode: ${useSharedEnv ? "shared Environment.default" : "child env"}, driver: ${driver ?? "default"}`
  );

  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`[Restart] --- attempt ${attempt} ---`);
    const server = await startNode(attempt);
    console.log(`[Restart] online=${server.lifecycle.isOnline}`);
    console.log(`[Restart] qr=${server.state.commissioning.pairingCodes.qrPairingCode}`);
    await new Promise((r) => setTimeout(r, 500));
    await server.close();
    console.log(`[Restart] closed ${attempt}`);
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("[Restart] SUCCESS — node restarts cleanly in-process");
}

main()
  .then(() => {
    rmSync(storageDir, { recursive: true, force: true });
    process.exit(0);
  })
  .catch((error) => {
    console.error("[Restart] FAILED:", error);
    if (error?.cause) {
      console.error("[Restart] cause:", error.cause);
    }
    try {
      rmSync(storageDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    process.exit(1);
  });
