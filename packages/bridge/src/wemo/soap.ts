/**
 * SOAP Client for WeMo Device Communication
 *
 * WeMo devices use SOAP (Simple Object Access Protocol) over HTTP
 * for device control and state queries.
 */

import { XMLParser } from "fast-xml-parser";
import type { SoapResponse } from "./types";

/**
 * Custom error class for SOAP-related errors.
 */
export class SoapError extends Error {
  public readonly code: SoapErrorCode;
  public readonly statusCode?: number;

  constructor(message: string, code: SoapErrorCode, statusCode?: number, cause?: Error) {
    super(message, { cause });
    this.name = "SoapError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Error codes for SOAP operations.
 */
export enum SoapErrorCode {
  /** Network connection failed */
  ConnectionFailed = "CONNECTION_FAILED",
  /** Request timed out */
  Timeout = "TIMEOUT",
  /** Invalid XML in response */
  InvalidXml = "INVALID_XML",
  /** SOAP fault returned by device */
  SoapFault = "SOAP_FAULT",
  /** HTTP error (non-200 status) */
  HttpError = "HTTP_ERROR",
  /** Unknown error */
  Unknown = "UNKNOWN",
}

/**
 * XML namespace constants for SOAP envelopes.
 */
const SOAP_NAMESPACES = {
  envelope: "http://schemas.xmlsoap.org/soap/envelope/",
  encoding: "http://schemas.xmlsoap.org/soap/encoding/",
} as const;

/**
 * Default timeout for SOAP requests in milliseconds.
 */
const DEFAULT_TIMEOUT = 10000;

/**
 * XML parser instance configured for WeMo responses.
 */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
  // Remove namespace prefixes for easier access
  removeNSPrefix: true,
});

/**
 * Builds a SOAP envelope for WeMo device communication.
 *
 * @param serviceType - The UPnP service type (e.g., "urn:Belkin:service:basicevent:1")
 * @param action - The SOAP action name (e.g., "GetBinaryState", "SetBinaryState")
 * @param body - Optional XML body content for the action
 * @returns Complete SOAP envelope XML string
 *
 * @example
 * ```ts
 * // Get device state
 * const envelope = buildSoapEnvelope(
 *   "urn:Belkin:service:basicevent:1",
 *   "GetBinaryState"
 * );
 *
 * // Set device state
 * const envelope = buildSoapEnvelope(
 *   "urn:Belkin:service:basicevent:1",
 *   "SetBinaryState",
 *   "<BinaryState>1</BinaryState>"
 * );
 * ```
 */
export function buildSoapEnvelope(serviceType: string, action: string, body?: string): string {
  const bodyContent = body ?? "";

  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="${SOAP_NAMESPACES.envelope}" s:encodingStyle="${SOAP_NAMESPACES.encoding}">
  <s:Body>
    <u:${action} xmlns:u="${serviceType}">
      ${bodyContent}
    </u:${action}>
  </s:Body>
</s:Envelope>`;
}

/**
 * Sends a SOAP request to a WeMo device.
 *
 * @param host - Device IP address
 * @param port - Device port (typically 49153)
 * @param controlURL - The control URL path (e.g., "/upnp/control/basicevent1")
 * @param serviceType - The UPnP service type
 * @param action - The SOAP action name
 * @param body - Optional XML body content
 * @param timeout - Request timeout in milliseconds (default: 10000)
 * @returns Parsed SOAP response
 *
 * @example
 * ```ts
 * const response = await soapRequest(
 *   "192.168.1.100",
 *   49153,
 *   "/upnp/control/basicevent1",
 *   "urn:Belkin:service:basicevent:1",
 *   "GetBinaryState"
 * );
 *
 * if (response.success) {
 *   console.log("Device state:", response.data);
 * }
 * ```
 */
export async function soapRequest<T = unknown>(
  host: string,
  port: number,
  controlURL: string,
  serviceType: string,
  action: string,
  body?: string,
  timeout: number = DEFAULT_TIMEOUT
): Promise<SoapResponse<T>> {
  const url = `http://${host}:${port}${controlURL}`;
  const soapEnvelope = buildSoapEnvelope(serviceType, action, body);
  const soapAction = `"${serviceType}#${action}"`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": 'text/xml; charset="utf-8"',
        SOAPACTION: soapAction,
        "Content-Length": String(Buffer.byteLength(soapEnvelope, "utf-8")),
      },
      body: soapEnvelope,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseText = await response.text();

    if (!response.ok) {
      // Try to parse SOAP fault from error response
      const fault = parseSoapFault(responseText);
      if (fault) {
        return {
          success: false,
          error: `SOAP Fault: ${fault.faultString}`,
          statusCode: response.status,
        };
      }

      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        statusCode: response.status,
      };
    }

    // Parse successful response
    const parsed = parseXmlResponse<T>(responseText, action);
    return {
      success: true,
      data: parsed,
      statusCode: response.status,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return {
          success: false,
          error: `Request timed out after ${timeout}ms`,
        };
      }

      // Connection errors
      if (
        error.message.includes("ECONNREFUSED") ||
        error.message.includes("EHOSTUNREACH") ||
        error.message.includes("ENETUNREACH")
      ) {
        return {
          success: false,
          error: `Connection failed: ${error.message}`,
        };
      }

      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: false,
      error: "Unknown error occurred",
    };
  }
}

/**
 * Parses an XML response and extracts the action response body.
 *
 * @param xml - Raw XML response string
 * @param action - The action name to extract response for
 * @returns Parsed response data
 */
export function parseXmlResponse<T>(xml: string, action: string): T {
  try {
    const parsed = xmlParser.parse(xml);

    // Navigate through SOAP envelope structure
    // Response structure: Envelope > Body > {Action}Response
    const envelope = parsed.Envelope ?? parsed["s:Envelope"];
    if (!envelope) {
      throw new SoapError("Invalid SOAP response: missing Envelope", SoapErrorCode.InvalidXml);
    }

    const body = envelope.Body ?? envelope["s:Body"];
    if (!body) {
      throw new SoapError("Invalid SOAP response: missing Body", SoapErrorCode.InvalidXml);
    }

    // The response element is named {Action}Response
    const responseKey = `${action}Response`;
    const responseData = body[responseKey] ?? body[`u:${responseKey}`] ?? body[`m:${responseKey}`];

    if (responseData === undefined) {
      // Some responses might be empty, which is valid
      return {} as T;
    }

    return responseData as T;
  } catch (error) {
    if (error instanceof SoapError) {
      throw error;
    }
    throw new SoapError(
      `Failed to parse XML response: ${error instanceof Error ? error.message : "Unknown error"}`,
      SoapErrorCode.InvalidXml,
      undefined,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Parses a SOAP fault from an error response.
 */
interface SoapFault {
  faultCode: string;
  faultString: string;
  detail?: string;
}

function parseSoapFault(xml: string): SoapFault | null {
  try {
    const parsed = xmlParser.parse(xml);
    const envelope = parsed.Envelope ?? parsed["s:Envelope"];
    const body = envelope?.Body ?? envelope?.["s:Body"];
    const fault = body?.Fault ?? body?.["s:Fault"];

    if (!fault) {
      return null;
    }

    return {
      faultCode: String(fault.faultcode ?? fault.faultCode ?? "Unknown"),
      faultString: String(fault.faultstring ?? fault.faultString ?? "Unknown error"),
      detail: fault.detail ? String(fault.detail) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Extracts a text value from a parsed XML element.
 * Handles both direct string values and objects with #text property.
 */
export function extractTextValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (value && typeof value === "object" && "#text" in value) {
    return String((value as { "#text": unknown })["#text"]);
  }
  return "";
}

/**
 * Extracts a numeric value from a parsed XML element.
 *
 * Returns undefined when the value is absent, empty, or malformed, so
 * callers can tell "not reported" apart from a real 0. In particular, a
 * dimmer that reports no <brightness> element has unknown brightness,
 * not brightness 0.
 */
export function extractNumericValue(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const text = extractTextValue(value);
  if (text.trim() === "") {
    return undefined;
  }
  const num = Number(text);
  // Reject NaN and non-finite values: "<brightness>Infinity</brightness>"
  // used to parse as 100 (via the clamp in the caller) instead of
  // unknown, and a non-finite BinaryState would normalize to "on".
  return Number.isFinite(num) ? num : undefined;
}
