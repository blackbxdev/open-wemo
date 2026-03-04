/**
 * WeMo Device Time Synchronization
 *
 * Syncs a WeMo device's internal clock via the timesync:1 SOAP service.
 * Required for timer/schedule rules to fire at the correct time, since
 * Belkin's cloud (which previously handled this) is deprecated.
 */

import { extractTextValue, soapRequest } from "./soap";

/**
 * Service type for time synchronization.
 */
const TIMESYNC_SERVICE = "urn:Belkin:service:timesync:1";

/**
 * Control URL for timesync SOAP actions.
 */
const TIMESYNC_CONTROL_URL = "/upnp/control/timesync1";

/**
 * Returns the UTC offset in WeMo's expected "[-]HH.MM" format.
 * ouimeaux (working Python WeMo lib) sends e.g. "-07.00", "05.30".
 * The device silently ignores other formats like integer -7 or "-0700".
 */
function getWemoTimezone(): string {
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes < 0 ? "-" : "";
  const abs = Math.abs(offsetMinutes);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  return `${sign}${String(hh).padStart(2, "0")}.${String(mm).padStart(2, "0")}`;
}

/**
 * Detects whether the server is currently observing daylight saving time.
 */
function isDst(): boolean {
  const now = new Date();
  const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
  const standardOffset = Math.max(jan, jul);
  return now.getTimezoneOffset() < standardOffset;
}

/**
 * Synchronizes a WeMo device's internal clock with the server's time.
 *
 * Sends the current UTC timestamp, timezone offset, and DST status
 * so the device can execute timer rules at the correct local time.
 *
 * @param host - Device IP address
 * @param port - Device port
 */
export async function syncDeviceTime(host: string, port: number): Promise<void> {
  const utc = Math.floor(Date.now() / 1000);
  const timezone = getWemoTimezone();
  const dst = isDst() ? 1 : 0;

  const body = `<UTC>${utc}</UTC><TimeZone>${timezone}</TimeZone><dst>${dst}</dst><DstSupported>1</DstSupported>`;

  console.debug("[TimeSync] Syncing device time", {
    host,
    port,
    utc,
    timezone,
    dst,
  });

  const response = await soapRequest(
    host,
    port,
    TIMESYNC_CONTROL_URL,
    TIMESYNC_SERVICE,
    "TimeSync",
    body
  );

  if (!response.success) {
    console.warn("[TimeSync] TimeSync failed (non-fatal)", {
      host,
      port,
      error: response.error ?? "Unknown error",
    });
    return;
  }

  console.debug("[TimeSync] TimeSync succeeded", { host, port });
}

/**
 * Queries a WeMo device's current time via GetTime SOAP action.
 *
 * @param host - Device IP address
 * @param port - Device port
 * @returns Device time info, or null if the call fails
 */
export async function getDeviceTime(
  host: string,
  port: number
): Promise<{ utc: number; timezone: string; dst: number; localTime: string } | null> {
  interface GetTimeResponse {
    UTC?: unknown;
    TimeZone?: unknown;
    dst?: unknown;
  }

  const response = await soapRequest<GetTimeResponse>(
    host,
    port,
    TIMESYNC_CONTROL_URL,
    TIMESYNC_SERVICE,
    "GetTime"
  );

  if (!response.success || !response.data) {
    console.warn("[TimeSync] GetTime failed", {
      host,
      port,
      error: response.error ?? "Unknown error",
    });
    return null;
  }

  const utc = Number(extractTextValue(response.data.UTC)) || 0;
  const timezone = extractTextValue(response.data.TimeZone);
  const dst = Number(extractTextValue(response.data.dst)) || 0;

  const deviceDate = new Date(utc * 1000);
  const localTime = deviceDate.toISOString();

  console.debug("[TimeSync] Device time", {
    host,
    port,
    utc,
    timezone,
    dst,
    localTime,
    serverUtc: Math.floor(Date.now() / 1000),
    drift: Math.floor(Date.now() / 1000) - utc,
  });

  return { utc, timezone, dst, localTime };
}
