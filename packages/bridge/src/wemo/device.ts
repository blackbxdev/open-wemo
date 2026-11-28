/**
 * WeMo Device Client
 *
 * High-level client for controlling WeMo devices via SOAP.
 */

import { extractNumericValue, extractTextValue, soapRequest } from "./soap";
import { WemoDeviceType } from "./types";
import type { DeviceState, WemoDevice, WemoService } from "./types";

/**
 * Service type constants for WeMo devices.
 */
const BASIC_EVENT_SERVICE = "urn:Belkin:service:basicevent:1";

/**
 * Default retry configuration.
 */
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_RETRY_DELAY = 500;

/** The state a SetBinaryState response carries, when it carries one. */
interface SetBinaryStateResponse {
  BinaryState?: unknown;
  brightness?: unknown;
}

/**
 * Parses the first field of a BinaryState value. The field is a compound
 * status on some devices ("8|123" = standby with extra fields); only
 * the first field is the power state.
 */
function parseBinaryStateField(value: unknown): number | undefined {
  const first = typeof value === "string" ? value.split("|")[0] : value;
  return extractNumericValue(first);
}

/**
 * Normalizes a parsed BinaryState value to 0, 1, or 8.
 * A missing or garbage value is off (0): that was the behavior before
 * the first review round changed it to on, and toggle() picks its
 * command from this value, so assuming "on" for an unrecognized value
 * would send the wrong command. Only 0, 1, and 8 are real states.
 */
function normalizeBinaryState(value: unknown): 0 | 1 | 8 {
  const state = parseBinaryStateField(value);
  if (state === 1) return 1;
  if (state === 8) return 8;
  return 0;
}

/**
 * Parses the state a SetBinaryState response carries, when it carries
 * one. The response fields are the device's confirmed state — the
 * pyWeMo recordings show both BinaryState and brightness — but a
 * response may carry neither, in which case this returns undefined and
 * the caller must read the state back instead of guessing it.
 */
function parseSetResponseState(response: {
  BinaryState?: unknown;
  brightness?: unknown;
}): DeviceState | undefined {
  const rawState = parseBinaryStateField(response.BinaryState);
  if (rawState !== 0 && rawState !== 1 && rawState !== 8) {
    return undefined;
  }
  const state: DeviceState = { binaryState: rawState };
  const brightness = extractNumericValue(response.brightness);
  if (brightness !== undefined) {
    state.brightness = Math.max(0, Math.min(100, brightness));
  }
  return state;
}

/**
 * Error thrown when a device operation fails.
 */
export class DeviceError extends Error {
  public readonly deviceId: string;
  public readonly operation: string;

  constructor(message: string, deviceId: string, operation: string, cause?: Error) {
    super(message, { cause });
    this.name = "DeviceError";
    this.deviceId = deviceId;
    this.operation = operation;
  }
}

/**
 * Client for controlling a WeMo device.
 *
 * @example
 * ```ts
 * const device = await getDeviceByAddress("192.168.1.100");
 * const client = new WemoDeviceClient(device);
 *
 * // Get current state
 * const state = await client.getState();
 * console.log(state.binaryState === 1 ? "ON" : "OFF");
 *
 * // Turn on
 * await client.setState(true);
 *
 * // Toggle
 * const newState = await client.toggle();
 * ```
 */
export class WemoDeviceClient {
  private readonly device: WemoDevice;
  private readonly basicEventService: WemoService | undefined;

  constructor(device: WemoDevice) {
    this.device = device;
    this.basicEventService = device.services.find((s) => s.serviceType.includes("basicevent"));
  }

  /**
   * Gets the device info.
   */
  get info(): WemoDevice {
    return this.device;
  }

  /**
   * Gets the device ID.
   */
  get id(): string {
    return this.device.id;
  }

  /**
   * Gets the device name.
   */
  get name(): string {
    return this.device.name;
  }

  /**
   * Gets the device host (IP address).
   */
  get host(): string {
    return this.device.host;
  }

  /**
   * Gets the device port.
   */
  get port(): number {
    return this.device.port;
  }

  /**
   * Gets the control URL for basic event service.
   */
  private get controlURL(): string {
    return this.basicEventService?.controlURL ?? "/upnp/control/basicevent1";
  }

  /**
   * Executes a SOAP request with retry logic.
   */
  private async executeWithRetry<T>(
    action: string,
    body?: string,
    retries = DEFAULT_RETRY_COUNT
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await soapRequest<T>(
        this.device.host,
        this.device.port,
        this.controlURL,
        BASIC_EVENT_SERVICE,
        action,
        body
      );

      if (response.success && response.data !== undefined) {
        return response.data;
      }

      lastError = new Error(response.error ?? "Unknown error");

      // Don't retry on last attempt
      if (attempt < retries) {
        await this.delay(DEFAULT_RETRY_DELAY * (attempt + 1));
      }
    }

    throw new DeviceError(
      `Failed to ${action} after ${retries + 1} attempts: ${lastError?.message}`,
      this.device.id,
      action,
      lastError
    );
  }

  /**
   * Delays execution for a specified duration.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Gets the current binary state of the device.
   *
   * @returns 0 for off, 1 for on, 8 for standby (Insight devices)
   */
  async getBinaryState(): Promise<0 | 1 | 8> {
    interface BinaryStateResponse {
      BinaryState?: unknown;
    }

    const response = await this.executeWithRetry<BinaryStateResponse>("GetBinaryState");
    return normalizeBinaryState(response.BinaryState);
  }

  /**
   * Gets the brightness level (0-100) for dimmable devices.
   *
   * @returns Brightness level, or undefined when the device does not report one
   */
  async getBrightness(): Promise<number | undefined> {
    interface BinaryStateResponse {
      BinaryState?: unknown;
      brightness?: unknown;
    }

    const response = await this.executeWithRetry<BinaryStateResponse>("GetBinaryState");
    const brightness = extractNumericValue(response.brightness);
    if (brightness === undefined) {
      return undefined;
    }
    return Math.max(0, Math.min(100, brightness));
  }

  /**
   * Sets the binary state of the device.
   *
   * @param state - 0 for off, 1 for on
   * @returns The state the Set response carries, if it carries one
   */
  async setBinaryState(state: 0 | 1): Promise<DeviceState | undefined> {
    const response = await this.executeWithRetry<SetBinaryStateResponse>(
      "SetBinaryState",
      `<BinaryState>${state}</BinaryState>`
    );
    return parseSetResponseState(response);
  }

  /**
   * Sets the brightness level (0-100) on a standalone dimmer.
   * A level of 0 turns the device off; any other level turns it on
   * at that brightness. A nonzero level that rounds to 0 (for example
   * 0.4) is raised to 1, so it turns the device on instead of off.
   *
   * Only standalone Dimmers support this: a plain Switch would merely
   * toggle on a positive level, and a Link-bridge Bulb needs
   * SetDeviceStatus (level capability 10008), not SetBinaryState.
   *
   * @param level - Brightness level from 0 to 100
   * @returns The effective level sent to the device (0-100), plus the
   * state the Set response carries when it carries one — that is the
   * device's confirmed state, so the caller can use it instead of
   * reading the state back.
   */
  async setBrightness(level: number): Promise<{ level: number; state?: DeviceState }> {
    if (this.device.deviceType !== WemoDeviceType.Dimmer) {
      throw new DeviceError(
        `Device does not support brightness control (type: ${this.device.deviceType})`,
        this.device.id,
        "SetBinaryState"
      );
    }
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    // A nonzero request must never round down to off.
    const effective = level > 0 && clamped === 0 ? 1 : clamped;
    if (effective === 0) {
      const state = await this.setBinaryState(0);
      return { level: 0, state };
    }
    const response = await this.executeWithRetry<SetBinaryStateResponse>(
      "SetBinaryState",
      `<BinaryState>1</BinaryState><brightness>${effective}</brightness>`
    );
    return { level: effective, state: parseSetResponseState(response) };
  }

  /**
   * Gets the current state of the device.
   *
   * @returns Device state including binary state and brightness (if applicable)
   */
  async getState(): Promise<DeviceState> {
    interface BinaryStateResponse {
      BinaryState?: unknown;
      brightness?: unknown;
    }

    // One GetBinaryState round trip: power and brightness come from the
    // same response, so they can never describe different moments, and
    // a missing brightness element no longer discards a valid power
    // state.
    const response = await this.executeWithRetry<BinaryStateResponse>("GetBinaryState");

    const state: DeviceState = {
      binaryState: normalizeBinaryState(response.BinaryState),
    };

    const brightness = extractNumericValue(response.brightness);
    if (brightness !== undefined) {
      state.brightness = Math.max(0, Math.min(100, brightness));
    }

    return state;
  }

  /**
   * Sets the device state (on or off).
   *
   * @param on - true to turn on, false to turn off
   */
  async setState(on: boolean): Promise<void> {
    await this.setBinaryState(on ? 1 : 0);
  }

  /**
   * Turns the device on.
   */
  async turnOn(): Promise<void> {
    await this.setState(true);
  }

  /**
   * Turns the device off.
   */
  async turnOff(): Promise<void> {
    await this.setState(false);
  }

  /**
   * Toggles the device state.
   *
   * @returns The new state after toggling
   */
  async toggle(): Promise<DeviceState> {
    const currentState = await this.getBinaryState();
    // Explicitly type the new state to avoid unsafe assertion
    const newState: 0 | 1 = currentState === 0 ? 1 : 0;
    await this.setBinaryState(newState);

    return {
      binaryState: newState,
    };
  }

  /**
   * Gets the friendly name of the device.
   */
  async getFriendlyName(): Promise<string> {
    interface FriendlyNameResponse {
      FriendlyName?: unknown;
    }

    const response = await this.executeWithRetry<FriendlyNameResponse>("GetFriendlyName");
    return extractTextValue(response.FriendlyName) || this.device.name;
  }

  /**
   * Sets the friendly name of the device.
   *
   * @param name - New name for the device
   */
  async setFriendlyName(name: string): Promise<void> {
    // Escape XML special characters
    const escapedName = name
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

    await this.executeWithRetry(
      "ChangeFriendlyName",
      `<FriendlyName>${escapedName}</FriendlyName>`
    );
  }

  /**
   * Checks if the device is reachable.
   *
   * @returns true if device responds, false otherwise
   */
  async isReachable(): Promise<boolean> {
    try {
      await this.getBinaryState();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Creates a device client from a WemoDevice object.
 *
 * @param device - The WemoDevice to create a client for
 * @returns A new WemoDeviceClient instance
 */
export function createDeviceClient(device: WemoDevice): WemoDeviceClient {
  return new WemoDeviceClient(device);
}
