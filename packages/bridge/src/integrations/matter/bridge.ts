/**
 * Matter Bridge — exposes Open Wemo devices to Google Home / Matter controllers.
 */

import "@matter/nodejs";
import { Endpoint, Environment, ServerNode, StorageService, VendorId } from "@matter/main";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors/bridged-device-basic-information";
import { OnOffLightDevice } from "@matter/main/devices/on-off-light";
import { OnOffPlugInUnitDevice } from "@matter/main/devices/on-off-plug-in-unit";
import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";
import type { DeviceService } from "../../device-service";
import type { SavedDevice } from "../../wemo/types";
import { getKindOverride, setKindOverride } from "./kinds";
import {
  type MatterDeviceKind,
  type MatterKindSource,
  resolveMatterKind,
  toMatterEndpointId,
  toMatterUniqueId,
} from "./mapper";
import { completePendingReset, getMatterStorageDir, getOrCreateCredentials } from "./storage";

/** Default Matter UDP port. */
export const MATTER_PORT = 5540;

/** Persistence backend for Matter fabric data (see configureStorageDriver). */
const MATTER_STORAGE_DRIVER = "sqlite";

export interface MatterPairingInfo {
  qrPairingCode: string;
  manualPairingCode: string;
  passcode: number;
  discriminator: number;
  commissioned: boolean;
}

export interface MatterIdentity {
  vendorId: number;
  productId: number;
  /** Hex form shown in the UI, e.g. "0xFFF1" */
  vendorIdHex: string;
  productIdHex: string;
}

export interface MatterDeviceStatus {
  id: string;
  name: string;
  wemoType: string;
  matterKind: MatterDeviceKind;
  autoKind: MatterDeviceKind;
  source: MatterKindSource;
  /** True when an endpoint is currently advertised on the Matter fabric. */
  exposed: boolean;
}

export interface MatterBridgeStatus {
  running: boolean;
  commissioned: boolean;
  deviceCount: number;
  /** Devices skipped because their type has no Matter on/off equivalent. */
  skippedCount: number;
  devices: MatterDeviceStatus[];
  pairing: MatterPairingInfo | null;
  identity: MatterIdentity;
  port: number;
  storagePath: string;
  error?: string;
}

function toHex(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * Selects SQLite for Matter's persistence.
 *
 * The default file driver writes each key to `<key>.tmp` and renames it over
 * the live file. Under Bun on Windows that rename intermittently fails with
 * EPERM, which aborts commissioning and leaves the Matter environment crashed
 * so it cannot be restarted in-process. matter.js migrates existing file-based
 * storage automatically.
 */
function configureStorageDriver(): void {
  try {
    const storage = Environment.default.get(StorageService);
    storage.configuredDriver = MATTER_STORAGE_DRIVER;
    storage.configuredBlobDriver = MATTER_STORAGE_DRIVER;
  } catch (error) {
    console.warn("[Matter] Could not select SQLite storage driver, using default:", error);
  }
}

/**
 * Runs a Matter aggregator bridge backed by DeviceService.
 */
export class MatterBridge {
  private server: ServerNode | null = null;
  private aggregator: Endpoint | null = null;
  /** Endpoints keyed by WeMo device id (typed loosely for Matter cluster state). */
  private endpoints = new Map<string, Endpoint>();
  /** Matter kind currently advertised for each endpoint (for recreate-on-change). */
  private endpointKinds = new Map<string, MatterDeviceKind>();
  /** Device IDs currently being updated from DeviceService (avoid feedback loops). */
  private ignoreMatterWrites = new Set<string>();
  private unsubscribers: Array<() => void> = [];
  private lastError: string | undefined;
  private starting = false;

  constructor(private readonly deviceService: DeviceService) {}

  get isRunning(): boolean {
    return this.server?.lifecycle.isOnline === true;
  }

  /**
   * Starts the Matter bridge and syncs all saved devices.
   */
  async start(): Promise<void> {
    if (this.server || this.starting) {
      console.log("[Matter] Already started or starting");
      return;
    }
    this.starting = true;
    this.lastError = undefined;

    try {
      const storageDir = getMatterStorageDir();
      const credentials = getOrCreateCredentials();

      await completePendingReset();

      Environment.default.vars.set("path.root", storageDir);
      configureStorageDriver();

      console.log(`[Matter] Starting bridge (storage: ${storageDir})`);

      this.server = await ServerNode.create({
        id: "open-wemo",
        network: { port: MATTER_PORT },
        commissioning: {
          passcode: credentials.passcode,
          discriminator: credentials.discriminator,
        },
        productDescription: {
          name: "Open Wemo",
          deviceType: AggregatorEndpoint.deviceType,
        },
        basicInformation: {
          vendorName: "Open Wemo",
          vendorId: VendorId(credentials.vendorId),
          nodeLabel: "Open Wemo",
          productName: "Open Wemo Bridge",
          productLabel: "WeMo Matter Bridge",
          productId: credentials.productId,
          serialNumber: credentials.uniqueId.slice(0, 32),
          uniqueId: credentials.uniqueId,
        },
      });

      console.log(
        `[Matter] Identity: vendorId=${toHex(credentials.vendorId)} productId=${toHex(credentials.productId)}`
      );

      this.aggregator = new Endpoint(AggregatorEndpoint, { id: "aggregator" });
      await this.server.add(this.aggregator);

      // Sync existing devices before going online
      const devices = this.deviceService.listDevices();
      for (const device of devices) {
        await this.addDeviceEndpoint(device);
      }

      this.subscribeToDeviceService();
      await this.server.start();

      const pairing = this.getPairingInfo();
      console.log(`[Matter] Bridge online — ${this.endpoints.size} device(s)`);
      if (pairing && !pairing.commissioned) {
        console.log(`[Matter] Manual pairing code: ${pairing.manualPairingCode}`);
        console.log(`[Matter] QR pairing code: ${pairing.qrPairingCode}`);
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error("[Matter] Failed to start:", error);
      await this.cleanup();
      throw error;
    } finally {
      this.starting = false;
    }
  }

  /**
   * Erases commissioned fabrics via the Matter factory-reset flow.
   *
   * Preferred over deleting storage files: the node keeps its own handles, so
   * on-disk cleanup from another code path fails while the process is alive.
   */
  async factoryReset(): Promise<void> {
    if (!this.server) {
      throw new Error("Matter bridge is not running");
    }
    console.log("[Matter] Performing factory reset...");
    await this.server.erase();
    console.log("[Matter] Factory reset complete");
  }

  /**
   * Stops the Matter bridge.
   */
  async stop(): Promise<void> {
    console.log("[Matter] Stopping bridge...");
    await this.cleanup();
    console.log("[Matter] Bridge stopped");
  }

  private async cleanup(): Promise<void> {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    this.endpoints.clear();
    this.endpointKinds.clear();
    this.ignoreMatterWrites.clear();

    if (this.server) {
      try {
        await this.server.close();
      } catch (error) {
        console.error("[Matter] Error closing server:", error);
      }
    }
    this.server = null;
    this.aggregator = null;
  }

  /**
   * Lists Matter kind status for every saved WeMo device.
   */
  listDeviceStatuses(): MatterDeviceStatus[] {
    return this.deviceService.listDevices().map((device) => {
      const override = getKindOverride(device.id);
      const resolved = resolveMatterKind(device.deviceType, override);
      return {
        id: device.id,
        name: device.name,
        wemoType: device.deviceType,
        matterKind: resolved.kind,
        autoKind: resolved.autoKind,
        source: resolved.source,
        exposed: this.endpoints.has(device.id),
      };
    });
  }

  getStatus(): MatterBridgeStatus {
    const credentials = getOrCreateCredentials();
    const devices = this.listDeviceStatuses();
    return {
      running: this.isRunning,
      commissioned: this.server?.lifecycle.isCommissioned ?? false,
      deviceCount: this.endpoints.size,
      skippedCount: devices.filter((d) => d.matterKind === "skip").length,
      devices,
      pairing: this.getPairingInfo(),
      identity: {
        vendorId: credentials.vendorId,
        productId: credentials.productId,
        vendorIdHex: toHex(credentials.vendorId),
        productIdHex: toHex(credentials.productId),
      },
      port: MATTER_PORT,
      storagePath: getMatterStorageDir(),
      error: this.lastError,
    };
  }

  /**
   * Sets or clears a per-device Matter kind override and recreates the endpoint
   * when the bridge is running (device type is fixed at endpoint creation).
   */
  async setDeviceKind(
    deviceId: string,
    kind: MatterDeviceKind | null
  ): Promise<MatterBridgeStatus> {
    const device = this.deviceService.listDevices().find((d) => d.id === deviceId);
    if (!device) {
      throw new Error(`Device not found: ${deviceId}`);
    }

    setKindOverride(deviceId, kind);

    if (this.aggregator) {
      await this.removeDeviceEndpoint(deviceId);
      await this.addDeviceEndpoint(device);
    }

    return this.getStatus();
  }

  getPairingInfo(): MatterPairingInfo | null {
    if (!this.server) return null;
    try {
      const credentials = getOrCreateCredentials();
      const codes = this.server.state.commissioning.pairingCodes;
      return {
        qrPairingCode: codes.qrPairingCode,
        manualPairingCode: codes.manualPairingCode,
        passcode: credentials.passcode,
        discriminator: credentials.discriminator,
        commissioned: this.server.lifecycle.isCommissioned,
      };
    } catch {
      return null;
    }
  }

  private subscribeToDeviceService(): void {
    this.unsubscribers.push(
      this.deviceService.events.on("deviceAdded", (device) => {
        this.addDeviceEndpoint(device).catch((err) =>
          console.error(`[Matter] Failed to add device ${device.id}:`, err)
        );
      })
    );

    this.unsubscribers.push(
      this.deviceService.events.on("deviceRemoved", ({ id }) => {
        this.removeDeviceEndpoint(id).catch((err) =>
          console.error(`[Matter] Failed to remove device ${id}:`, err)
        );
      })
    );

    this.unsubscribers.push(
      this.deviceService.events.on("deviceUpdated", (device) => {
        this.updateDeviceEndpoint(device).catch((err) =>
          console.error(`[Matter] Failed to update device ${device.id}:`, err)
        );
      })
    );

    this.unsubscribers.push(
      this.deviceService.events.on("stateChanged", ({ id, isOn, source }) => {
        if (source === "matter") return;
        this.applyExternalState(id, isOn).catch((err) =>
          console.error(`[Matter] Failed to sync state for ${id}:`, err)
        );
      })
    );
  }

  private async addDeviceEndpoint(device: SavedDevice): Promise<void> {
    if (!this.aggregator) return;

    const resolved = resolveMatterKind(device.deviceType, getKindOverride(device.id));
    const kind = resolved.kind;
    if (kind === "skip") {
      console.log(`[Matter] Skipping device (kind=skip): ${device.deviceType} (${device.name})`);
      return;
    }

    if (this.endpoints.has(device.id)) {
      await this.updateDeviceEndpoint(device);
      return;
    }

    const endpointId = toMatterEndpointId(device.id);
    const uniqueId = toMatterUniqueId(device.id);
    // Actuator types only — never OnOffLightSwitch (Google shows no controls).
    const DeviceType =
      kind === "plug"
        ? OnOffPlugInUnitDevice.with(BridgedDeviceBasicInformationServer)
        : OnOffLightDevice.with(BridgedDeviceBasicInformationServer);

    // Poll initial state (best-effort)
    let initialOn = false;
    let reachable = true;
    try {
      const status = await this.deviceService.getState(device.id);
      if (status.isOnline && status.state !== undefined) {
        initialOn = status.state === 1 || status.state === 8;
      } else {
        reachable = false;
      }
    } catch {
      reachable = false;
    }

    const endpoint = new Endpoint(DeviceType, {
      id: endpointId,
      bridgedDeviceBasicInformation: {
        nodeLabel: truncateLabel(device.name),
        productName: truncateLabel(device.name),
        productLabel: truncateLabel(`${device.deviceType}`),
        serialNumber: uniqueId.slice(0, 32),
        uniqueId,
        reachable,
      },
      onOff: { onOff: initialOn },
    });

    await this.aggregator.add(endpoint);
    this.endpoints.set(device.id, endpoint);
    this.endpointKinds.set(device.id, kind);

    endpoint.events.onOff.onOff$Changed.on((value: boolean) => {
      void this.handleMatterOnOffChange(device.id, value);
    });

    console.log(`[Matter] Added endpoint for "${device.name}" (${kind}, ${resolved.source})`);
  }

  private async removeDeviceEndpoint(deviceId: string): Promise<void> {
    const endpoint = this.endpoints.get(deviceId);
    if (!endpoint) {
      this.endpointKinds.delete(deviceId);
      return;
    }
    try {
      await endpoint.delete();
    } catch (error) {
      console.error(`[Matter] Error deleting endpoint ${deviceId}:`, error);
    }
    this.endpoints.delete(deviceId);
    this.endpointKinds.delete(deviceId);
    console.log(`[Matter] Removed endpoint for ${deviceId}`);
  }

  private async updateDeviceEndpoint(device: SavedDevice): Promise<void> {
    const endpoint = this.endpoints.get(device.id);
    const resolved = resolveMatterKind(device.deviceType, getKindOverride(device.id));

    // Kind changed (or became skip) — recreate; device type is fixed at creation.
    if (!endpoint || this.endpointKinds.get(device.id) !== resolved.kind) {
      if (endpoint) {
        await this.removeDeviceEndpoint(device.id);
      }
      if (resolved.kind !== "skip") {
        await this.addDeviceEndpoint(device);
      }
      return;
    }

    try {
      await endpoint.setStateOf(BridgedDeviceBasicInformationServer, {
        nodeLabel: truncateLabel(device.name),
        productName: truncateLabel(device.name),
      });
    } catch (error) {
      console.error(`[Matter] Failed to rename endpoint ${device.id}:`, error);
    }
  }

  private async handleMatterOnOffChange(deviceId: string, value: boolean): Promise<void> {
    if (this.ignoreMatterWrites.has(deviceId)) {
      return;
    }

    console.log(`[Matter] Controller set ${deviceId} → ${value ? "ON" : "OFF"}`);
    try {
      if (value) {
        await this.deviceService.setOn(deviceId, "matter");
      } else {
        await this.deviceService.setOff(deviceId, "matter");
      }
      await this.setReachable(deviceId, true);
    } catch (error) {
      console.error(`[Matter] Failed to control WeMo device ${deviceId}:`, error);
      await this.setReachable(deviceId, false);
      // Revert Matter attribute to previous WeMo-side truth if possible
      try {
        const status = await this.deviceService.getState(deviceId);
        if (status.isOnline && status.state !== undefined) {
          await this.applyExternalState(deviceId, status.state === 1 || status.state === 8);
        }
      } catch {
        // ignore
      }
    }
  }

  private async applyExternalState(deviceId: string, isOn: boolean): Promise<void> {
    const endpoint = this.endpoints.get(deviceId);
    if (!endpoint) return;

    // Cluster state typing is endpoint-definition-dependent; cast for OnOff devices.
    const state = endpoint.state as { onOff?: { onOff?: boolean } };
    const current = state.onOff?.onOff;
    if (current === isOn) {
      await this.setReachable(deviceId, true);
      return;
    }

    this.ignoreMatterWrites.add(deviceId);
    try {
      await endpoint.set({ onOff: { onOff: isOn } } as never);
      await this.setReachable(deviceId, true);
    } catch (error) {
      console.error(`[Matter] Failed to apply external state for ${deviceId}:`, error);
    } finally {
      this.ignoreMatterWrites.delete(deviceId);
    }
  }

  private async setReachable(deviceId: string, reachable: boolean): Promise<void> {
    const endpoint = this.endpoints.get(deviceId);
    if (!endpoint) return;
    try {
      const current = endpoint.stateOf(BridgedDeviceBasicInformationServer).reachable;
      if (current === reachable) return;
      await endpoint.setStateOf(BridgedDeviceBasicInformationServer, { reachable });
    } catch {
      // ignore
    }
  }
}

function truncateLabel(value: string, max = 32): string {
  if (value.length <= max) return value;
  return value.slice(0, max);
}
