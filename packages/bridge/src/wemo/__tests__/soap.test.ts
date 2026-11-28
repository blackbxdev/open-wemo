/**
 * Tests for SOAP client functionality.
 */

import { describe, expect, test } from "bun:test";
import {
  buildSoapEnvelope,
  extractNumericValue,
  extractTextValue,
  parseXmlResponse,
} from "../soap";

describe("buildSoapEnvelope", () => {
  test("builds envelope without body", () => {
    const envelope = buildSoapEnvelope("urn:Belkin:service:basicevent:1", "GetBinaryState");

    expect(envelope).toContain('<?xml version="1.0" encoding="utf-8"?>');
    expect(envelope).toContain("s:Envelope");
    expect(envelope).toContain("s:Body");
    expect(envelope).toContain("u:GetBinaryState");
    expect(envelope).toContain('xmlns:u="urn:Belkin:service:basicevent:1"');
  });

  test("builds envelope with body content", () => {
    const envelope = buildSoapEnvelope(
      "urn:Belkin:service:basicevent:1",
      "SetBinaryState",
      "<BinaryState>1</BinaryState>"
    );

    expect(envelope).toContain("u:SetBinaryState");
    expect(envelope).toContain("<BinaryState>1</BinaryState>");
  });

  test("includes correct namespaces", () => {
    const envelope = buildSoapEnvelope("urn:Belkin:service:basicevent:1", "GetBinaryState");

    expect(envelope).toContain('xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"');
    expect(envelope).toContain('s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"');
  });
});

describe("parseXmlResponse", () => {
  test("parses GetBinaryState response", () => {
    const xml = `<?xml version="1.0"?>
      <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
        <s:Body>
          <u:GetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1">
            <BinaryState>1</BinaryState>
          </u:GetBinaryStateResponse>
        </s:Body>
      </s:Envelope>`;

    const result = parseXmlResponse<{ BinaryState: number }>(xml, "GetBinaryState");

    expect(result.BinaryState).toBe(1);
  });

  test("parses response with text content", () => {
    const xml = `<?xml version="1.0"?>
      <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
        <s:Body>
          <u:GetFriendlyNameResponse xmlns:u="urn:Belkin:service:basicevent:1">
            <FriendlyName>Living Room Lamp</FriendlyName>
          </u:GetFriendlyNameResponse>
        </s:Body>
      </s:Envelope>`;

    const result = parseXmlResponse<{ FriendlyName: string }>(xml, "GetFriendlyName");

    expect(result.FriendlyName).toBe("Living Room Lamp");
  });

  test("handles empty response body", () => {
    const xml = `<?xml version="1.0"?>
      <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
        <s:Body>
          <u:SetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1">
          </u:SetBinaryStateResponse>
        </s:Body>
      </s:Envelope>`;

    const result = parseXmlResponse(xml, "SetBinaryState");

    expect(result).toBeDefined();
  });

  test("throws on missing envelope", () => {
    const xml = "<NotAnEnvelope></NotAnEnvelope>";

    expect(() => parseXmlResponse(xml, "GetBinaryState")).toThrow("missing Envelope");
  });

  test("throws on missing body", () => {
    const xml = `<?xml version="1.0"?>
      <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
        <s:NotBody></s:NotBody>
      </s:Envelope>`;

    expect(() => parseXmlResponse(xml, "GetBinaryState")).toThrow("missing Body");
  });
});

describe("extractTextValue", () => {
  test("extracts string value", () => {
    expect(extractTextValue("hello")).toBe("hello");
  });

  test("extracts number as string", () => {
    expect(extractTextValue(42)).toBe("42");
  });

  test("extracts #text property", () => {
    expect(extractTextValue({ "#text": "value" })).toBe("value");
  });

  test("returns empty string for null/undefined", () => {
    expect(extractTextValue(null)).toBe("");
    expect(extractTextValue(undefined)).toBe("");
  });

  test("returns empty string for objects without #text", () => {
    expect(extractTextValue({ foo: "bar" })).toBe("");
  });
});

describe("extractNumericValue", () => {
  test("extracts numeric string", () => {
    expect(extractNumericValue("123")).toBe(123);
  });

  test("extracts number", () => {
    expect(extractNumericValue(456)).toBe(456);
  });

  test("extracts from #text property", () => {
    expect(extractNumericValue({ "#text": "789" })).toBe(789);
  });

  test("returns undefined for non-numeric", () => {
    expect(extractNumericValue("not a number")).toBeUndefined();
  });

  test("returns undefined for null/undefined", () => {
    expect(extractNumericValue(null)).toBeUndefined();
    expect(extractNumericValue(undefined)).toBeUndefined();
  });

  test("returns undefined for an empty string", () => {
    expect(extractNumericValue("")).toBeUndefined();
  });
});
