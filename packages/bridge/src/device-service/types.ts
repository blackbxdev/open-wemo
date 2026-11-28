/**
 * Types for the DeviceService integration boundary.
 */

import type { SavedDevice } from "../wemo/types";

/** Result of a device state poll. */
export type DeviceStateResult = {
  isOnline: boolean;
  state?: number;
  brightness?: number;
  error?: string;
};

/**
 * Result of an on/off/toggle/brightness control action.
 * `state`, `isOn`, and `brightness` are present only when observed:
 * when a write is acknowledged but its resulting state could not be
 * observed (no Set-reply state and a failed readback), they are
 * omitted — unknown — instead of reporting the sent level as if it
 * were confirmed state. Matter trusts stateChanged as the device's
 * actual state, so the event is likewise emitted only for observed
 * state.
 */
export type ControlResult = {
  id: string;
  action: "on" | "off" | "toggle" | "brightness";
  state?: number;
  isOn?: boolean;
  brightness?: number;
};

/** Saved device with optional live state. */
export type DeviceWithState = SavedDevice & DeviceStateResult;

/** Events emitted by DeviceService for integrations. */
export type DeviceServiceEventMap = {
  deviceAdded: SavedDevice;
  deviceRemoved: { id: string };
  deviceUpdated: SavedDevice;
  stateChanged: { id: string; state: number; isOn: boolean; source: "api" | "matter" | "poll" };
};
