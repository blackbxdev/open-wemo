/**
 * Types for the DeviceService integration boundary.
 */

import type { SavedDevice } from "../wemo/types";

/** Result of a device state poll. */
export type DeviceStateResult = {
  isOnline: boolean;
  state?: number;
  error?: string;
};

/** Result of an on/off/toggle control action. */
export type ControlResult = {
  id: string;
  action: "on" | "off" | "toggle";
  state: number;
  isOn: boolean;
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
