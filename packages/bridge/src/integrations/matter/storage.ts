/**
 * Matter storage paths and commissioning credential helpers.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAppDataDir } from "../../db";

/** Matter fabric / node storage directory under app data. */
export function getMatterStorageDir(): string {
  const dir = join(getAppDataDir(), "matter");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Matter test vendor IDs allocated by the Connectivity Standards Alliance.
 * Google Home only commissions uncertified devices whose VID/PID pair is
 * registered as a Matter integration in the Google Home Developer Console.
 */
export const TEST_VENDOR_IDS = [0xfff1, 0xfff2, 0xfff3, 0xfff4] as const;

/** Default identity used until the user configures their own VID/PID. */
export const DEFAULT_VENDOR_ID = 0xfff1;
export const DEFAULT_PRODUCT_ID = 0x8001;

export interface MatterCredentials {
  passcode: number;
  discriminator: number;
  uniqueId: string;
  vendorId: number;
  productId: number;
}

const CREDENTIALS_FILE = "credentials.json";

function credentialsPath(): string {
  return join(getMatterStorageDir(), CREDENTIALS_FILE);
}

function writeCredentials(credentials: MatterCredentials): MatterCredentials {
  writeFileSync(credentialsPath(), JSON.stringify(credentials, null, 2), "utf-8");
  return credentials;
}

/**
 * Loads or creates stable Matter commissioning credentials.
 */
export function getOrCreateCredentials(): MatterCredentials {
  const path = credentialsPath();
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<MatterCredentials>;
      if (
        typeof parsed.passcode === "number" &&
        typeof parsed.discriminator === "number" &&
        typeof parsed.uniqueId === "string"
      ) {
        // Backfill identity fields added after the first release
        return {
          passcode: parsed.passcode,
          discriminator: parsed.discriminator,
          uniqueId: parsed.uniqueId,
          vendorId: parsed.vendorId ?? DEFAULT_VENDOR_ID,
          productId: parsed.productId ?? DEFAULT_PRODUCT_ID,
        };
      }
    } catch {
      // regenerate below
    }
  }

  return writeCredentials({
    // Standard Matter development setup passcode (8 digits, spec-valid)
    passcode: 20202021,
    // Discriminator 0-4095
    discriminator: 3840,
    uniqueId: `openwemo${Date.now().toString(16)}`.slice(0, 32),
    vendorId: DEFAULT_VENDOR_ID,
    productId: DEFAULT_PRODUCT_ID,
  });
}

/**
 * Updates the vendor/product identity advertised during commissioning.
 * Must match the Matter integration registered in the Google Home Developer Console.
 */
export function setMatterIdentity(vendorId: number, productId: number): MatterCredentials {
  if (!Number.isInteger(vendorId) || vendorId < 1 || vendorId > 0xfff4) {
    throw new Error("Invalid vendorId: must be an integer between 1 and 65524 (0xFFF4)");
  }
  if (!Number.isInteger(productId) || productId < 1 || productId > 0xffff) {
    throw new Error("Invalid productId: must be an integer between 1 and 65535");
  }

  const current = getOrCreateCredentials();
  return writeCredentials({ ...current, vendorId, productId });
}

/** Marker written when storage could not be deleted immediately. */
const RESET_MARKER = ".reset-pending";

function protectedEntry(entry: string): boolean {
  return entry === CREDENTIALS_FILE || entry === RESET_MARKER;
}

/**
 * Deletes Matter storage entries, retrying while the OS still holds handles.
 * Windows keeps SQLite files locked briefly after close.
 *
 * @returns entries that could not be removed
 */
async function removeStorageEntries(dir: string, attempts = 20): Promise<string[]> {
  let remaining = readdirSync(dir).filter((entry) => !protectedEntry(entry));

  for (let attempt = 0; attempt < attempts && remaining.length > 0; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    remaining = remaining.filter((entry) => {
      try {
        rmSync(join(dir, entry), { recursive: true, force: true });
        return false;
      } catch {
        return true;
      }
    });
  }

  return remaining;
}

/**
 * Deletes commissioned fabric data so the bridge can be paired again.
 * Commissioning credentials (passcode/discriminator) are preserved so the
 * QR code stays the same.
 *
 * @returns true if storage was fully cleared, false if leftovers were deferred
 *   to the next start (see {@link completePendingReset})
 */
export async function resetCommissioningState(): Promise<boolean> {
  const dir = getMatterStorageDir();
  const preserved = getOrCreateCredentials();

  const failed = await removeStorageEntries(dir);
  if (failed.length > 0) {
    console.warn(`[Matter] Storage still locked, deferring cleanup of: ${failed.join(", ")}`);
    writeFileSync(join(dir, RESET_MARKER), new Date().toISOString(), "utf-8");
  }

  writeCredentials(preserved);
  return failed.length === 0;
}

/**
 * Finishes a reset that could not complete because storage was locked.
 * Call before opening Matter storage.
 */
export async function completePendingReset(): Promise<void> {
  const dir = getMatterStorageDir();
  const marker = join(dir, RESET_MARKER);
  if (!existsSync(marker)) {
    return;
  }

  const failed = await removeStorageEntries(dir);
  if (failed.length > 0) {
    console.warn(`[Matter] Could not clear Matter storage: ${failed.join(", ")}`);
    return;
  }

  rmSync(marker, { force: true });
  console.log("[Matter] Completed deferred commissioning reset");
}
