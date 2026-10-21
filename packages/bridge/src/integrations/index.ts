/**
 * Integration manager — starts/stops smart-home integrations.
 */

import { getDatabase } from "../db";
import { getDeviceService } from "../device-service";
import {
  MATTER_PORT,
  MatterBridge,
  type MatterBridgeStatus,
  type MatterDeviceStatus,
} from "./matter/bridge";
import { getKindOverride, setKindOverride } from "./matter/kinds";
import { type MatterDeviceKind, resolveMatterKind } from "./matter/mapper";
import {
  DEFAULT_PRODUCT_ID,
  DEFAULT_VENDOR_ID,
  getMatterStorageDir,
  getOrCreateCredentials,
  resetCommissioningState,
  setMatterIdentity,
} from "./matter/storage";

export const MATTER_ENABLED_SETTING = "matter_enabled";

function listDeviceStatusesOffline(): MatterDeviceStatus[] {
  return getDeviceService()
    .listDevices()
    .map((device) => {
      const override = getKindOverride(device.id);
      const resolved = resolveMatterKind(device.deviceType, override);
      return {
        id: device.id,
        name: device.name,
        wemoType: device.deviceType,
        matterKind: resolved.kind,
        autoKind: resolved.autoKind,
        source: resolved.source,
        exposed: false,
      };
    });
}

/**
 * Owns integration lifecycle for the bridge process.
 */
export class IntegrationManager {
  private matter: MatterBridge | null = null;

  isMatterEnabled(): boolean {
    return getDatabase().getBoolSetting(MATTER_ENABLED_SETTING, false);
  }

  getMatterStatus(): MatterBridgeStatus {
    if (!this.matter) {
      const credentials = getOrCreateCredentials();
      const devices = listDeviceStatusesOffline();
      return {
        running: false,
        commissioned: false,
        deviceCount: 0,
        skippedCount: devices.filter((d) => d.matterKind === "skip").length,
        devices,
        pairing: null,
        identity: {
          vendorId: credentials.vendorId,
          productId: credentials.productId,
          vendorIdHex: `0x${credentials.vendorId.toString(16).toUpperCase().padStart(4, "0")}`,
          productIdHex: `0x${credentials.productId.toString(16).toUpperCase().padStart(4, "0")}`,
        },
        port: MATTER_PORT,
        storagePath: getMatterStorageDir(),
      };
    }
    return this.matter.getStatus();
  }

  getMatterBridge(): MatterBridge | null {
    return this.matter;
  }

  /**
   * Starts Matter if the user setting is enabled.
   */
  async startFromSettings(): Promise<void> {
    if (this.isMatterEnabled()) {
      await this.enableMatter();
    }
  }

  async enableMatter(): Promise<MatterBridgeStatus> {
    getDatabase().setBoolSetting(MATTER_ENABLED_SETTING, true);

    if (!this.matter) {
      this.matter = new MatterBridge(getDeviceService());
    }

    if (!this.matter.isRunning) {
      try {
        await this.matter.start();
      } catch (error) {
        console.error("[Integrations] Matter start failed:", error);
        // Keep setting enabled so user can retry / see error on status page
      }
    }

    return this.getMatterStatus();
  }

  async disableMatter(): Promise<MatterBridgeStatus> {
    getDatabase().setBoolSetting(MATTER_ENABLED_SETTING, false);
    if (this.matter) {
      await this.matter.stop();
      this.matter = null;
    }
    return this.getMatterStatus();
  }

  /**
   * Updates the advertised vendor/product IDs. These must match the Matter
   * integration registered in the Google Home Developer Console.
   * Restarts the bridge (and clears fabrics) so the new identity takes effect.
   */
  async setMatterIdentity(vendorId: number, productId: number): Promise<MatterBridgeStatus> {
    const wasEnabled = this.isMatterEnabled();

    // Identity is baked into commissioned fabrics, so start clean. Erase while
    // the node is still up; it owns its storage handles.
    if (this.matter?.isRunning) {
      await this.matter.factoryReset();
    }

    if (this.matter) {
      await this.matter.stop();
      this.matter = null;
    }

    setMatterIdentity(vendorId, productId);

    if (wasEnabled) {
      return this.enableMatter();
    }
    return this.getMatterStatus();
  }

  /**
   * Clears commissioned fabrics so the bridge can be paired again.
   */
  async resetMatterCommissioning(): Promise<MatterBridgeStatus> {
    // While the node is running it owns its storage handles, so ask Matter to
    // erase itself instead of deleting files underneath it.
    if (this.matter?.isRunning) {
      await this.matter.factoryReset();
      console.log("[Matter] Commissioning state reset");
      return this.getMatterStatus();
    }

    const wasEnabled = this.isMatterEnabled();

    if (this.matter) {
      await this.matter.stop();
      this.matter = null;
    }

    await resetCommissioningState();
    console.log("[Matter] Commissioning state reset");

    if (wasEnabled) {
      return this.enableMatter();
    }
    return this.getMatterStatus();
  }

  /**
   * Sets or clears a per-device Matter kind override.
   */
  async setDeviceKind(
    deviceId: string,
    kind: MatterDeviceKind | null
  ): Promise<MatterBridgeStatus> {
    if (this.matter) {
      return this.matter.setDeviceKind(deviceId, kind);
    }

    const device = getDeviceService()
      .listDevices()
      .find((d) => d.id === deviceId);
    if (!device) {
      throw new Error(`Device not found: ${deviceId}`);
    }
    setKindOverride(deviceId, kind);
    return this.getMatterStatus();
  }

  async stopAll(): Promise<void> {
    if (this.matter) {
      await this.matter.stop();
      this.matter = null;
    }
  }
}

export { DEFAULT_PRODUCT_ID, DEFAULT_VENDOR_ID };

let manager: IntegrationManager | null = null;

export function getIntegrationManager(): IntegrationManager {
  if (!manager) {
    manager = new IntegrationManager();
  }
  return manager;
}

export function resetIntegrationManager(): void {
  manager = null;
}
