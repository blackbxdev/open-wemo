/**
 * WeMo Protocol Type Definitions
 *
 * These types define the data structures used for communicating with
 * Belkin WeMo smart home devices over UPnP/SOAP.
 */

/**
 * Supported WeMo device types.
 * Each type has different capabilities and SOAP endpoints.
 */
export enum WemoDeviceType {
  /** Basic on/off switch */
  Switch = "Switch",
  /** Switch with power monitoring capabilities */
  Insight = "Insight",
  /** In-wall light switch */
  LightSwitch = "LightSwitch",
  /** Dimmable light switch */
  Dimmer = "Dimmer",
  /** Compact smart plug */
  Mini = "Mini",
  /** Smart LED bulb */
  Bulb = "Bulb",
  /** Motion sensor */
  Motion = "Motion",
  /** Device type could not be determined */
  Unknown = "Unknown",
}

/**
 * A UPnP service endpoint exposed by a WeMo device.
 * Devices expose multiple services for different functionality.
 */
export interface WemoService {
  /** Service type URN (e.g., "urn:Belkin:service:basicevent:1") */
  serviceType: string;
  /** Service ID URN */
  serviceId: string;
  /** Relative URL for SOAP control requests */
  controlURL: string;
  /** Relative URL for event subscriptions */
  eventSubURL: string;
  /** Relative URL for service description XML */
  SCPDURL: string;
}

/**
 * Represents a discovered WeMo device on the network.
 */
export interface WemoDevice {
  /** Unique identifier (typically MAC address or UUID from UPnP) */
  id: string;
  /** User-friendly device name (can be changed by user) */
  name: string;
  /** Type of WeMo device */
  deviceType: WemoDeviceType;
  /** IP address on local network */
  host: string;
  /** Port number for HTTP/SOAP communication (typically 49153) */
  port: number;
  /** Manufacturer name (always "Belkin International Inc.") */
  manufacturer: string;
  /** Model name (e.g., "Socket", "Insight") */
  model: string;
  /** Device serial number */
  serialNumber: string;
  /** Firmware version string */
  firmwareVersion: string;
  /** MAC address */
  macAddress: string;
  /** Available UPnP services */
  services: WemoService[];
  /** URL to device setup XML */
  setupUrl: string;
}

/**
 * Current state of a WeMo device.
 */
export interface DeviceState {
  /**
   * Binary on/off state.
   * - 0 = off
   * - 1 = on
   * - 8 = on (standby) for Insight devices
   */
  binaryState: 0 | 1 | 8;
  /**
   * Brightness level for dimmable devices (0-100).
   * Only applicable for Dimmer and Bulb types.
   */
  brightness?: number;
}

/**
 * Power monitoring parameters from WeMo Insight devices.
 * Parsed from the pipe-delimited GetInsightParams response.
 */
export interface InsightParams {
  /**
   * Current state of the device.
   * - 0 = off
   * - 1 = on
   * - 8 = on but in standby (below threshold)
   */
  state: 0 | 1 | 8;
  /** Unix timestamp of last state change (seconds) */
  lastChange: number;
  /** Seconds the device has been on during this session */
  onFor: number;
  /** Seconds the device has been on today */
  onToday: number;
  /** Total seconds the device has been on (lifetime) */
  onTotal: number;
  /** Time period for averages in seconds */
  timePeriod: number;
  /** Average power during time period (milliwatts) */
  averagePower: number;
  /** Current instantaneous power draw (milliwatts) */
  instantPower: number;
  /** Energy used today (milliwatt-hours) */
  todayEnergy: number;
  /** Total energy used lifetime (milliwatt-hours) */
  totalEnergy: number;
  /** Power threshold for standby detection (milliwatts) */
  standbyThreshold: number;
}

/**
 * Parsed and human-friendly power data derived from InsightParams.
 */
export interface PowerData {
  /** Whether the device is currently drawing power above standby threshold */
  isOn: boolean;
  /** Whether the device is in standby mode (on but below threshold) */
  isStandby: boolean;
  /** Current power draw in watts */
  currentWatts: number;
  /** Energy used today in kilowatt-hours */
  todayKwh: number;
  /** Total energy used in kilowatt-hours */
  totalKwh: number;
  /** How long the device has been on this session (formatted string) */
  onForFormatted: string;
  /** How long the device has been on today (formatted string) */
  onTodayFormatted: string;
}

/**
 * Result of a device discovery scan.
 */
export interface DiscoveryResult {
  /** List of discovered devices */
  devices: WemoDevice[];
  /** How long the scan took in milliseconds */
  scanDuration: number;
  /** Any errors encountered during scan */
  errors: string[];
}

/**
 * Result of a SOAP action request.
 */
export interface SoapResponse<T = unknown> {
  /** Whether the request succeeded */
  success: boolean;
  /** Parsed response data (if successful) */
  data?: T;
  /** Error message (if failed) */
  error?: string;
  /** HTTP status code */
  statusCode?: number;
}

/**
 * Options for device discovery.
 */
export interface DiscoveryOptions {
  /** Timeout in milliseconds for SSDP search (default: 5000) */
  timeout?: number;
  /** Specific device types to search for (default: all) */
  deviceTypes?: WemoDeviceType[];
  /** Network interface to use (default: all) */
  networkInterface?: string;
}

/**
 * Saved device configuration for persistence.
 */
export interface SavedDevice {
  /** Device ID (matches WemoDevice.id) */
  id: string;
  /** User-friendly name */
  name: string;
  /** Device type */
  deviceType: WemoDeviceType;
  /** Last known IP address */
  host: string;
  /** Last known port */
  port: number;
  /** When the device was first added */
  createdAt: string;
  /** When the device was last seen/updated */
  updatedAt: string;
  /** Whether the device is currently reachable */
  isOnline?: boolean;
}

/**
 * Action values for timer rules.
 */
export enum TimerAction {
  Off = 0,
  On = 1,
}

/**
 * Timer rule as stored on the WeMo device.
 */
export interface TimerRule {
  ruleID: number;
  name: string;
  type: "Timer";
  enabled: boolean;
  /** Seconds from midnight (0-86400) */
  startTime: number;
  /** Seconds from midnight (optional, for on/off pairs) */
  endTime?: number;
  startAction: TimerAction;
  endAction?: TimerAction;
  /** -1=daily, bitmask for specific days */
  dayId: number;
}

/**
 * Schedule data fetched from a device.
 */
export interface TimerSchedule {
  deviceId: string;
  rules: TimerRule[];
  dbVersion: number;
}

/**
 * Input for creating a new timer rule.
 */
export interface CreateTimerInput {
  name: string;
  startTime: number;
  endTime?: number;
  startAction: TimerAction;
  endAction?: TimerAction;
  dayId: number;
}

/**
 * Input for updating a timer rule.
 */
export interface UpdateTimerInput {
  name?: string;
  startTime?: number;
  endTime?: number;
  startAction?: TimerAction;
  endAction?: TimerAction;
  dayId?: number;
  enabled?: boolean;
}

/**
 * Day bitmask constants for timer schedules.
 */
export const DAYS = {
  DAILY: -1,
  SUN: 1,
  MON: 2,
  TUE: 4,
  WED: 8,
  THU: 16,
  FRI: 32,
  SAT: 64,
  WEEKDAYS: 2 + 4 + 8 + 16 + 32,
  WEEKENDS: 1 + 64,
  ALL: 127,
} as const;
