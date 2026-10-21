import { describe, expect, test } from "bun:test";
import { parseId } from "../matter";

describe("parseId", () => {
  test("accepts hex strings", () => {
    expect(parseId("0xFFF1", "vendorId")).toBe(65521);
    expect(parseId("0x8001", "productId")).toBe(32769);
    expect(parseId("  0xfff4  ", "vendorId")).toBe(65524);
  });

  test("accepts decimal strings and numbers", () => {
    expect(parseId("65521", "vendorId")).toBe(65521);
    expect(parseId(32769, "productId")).toBe(32769);
  });

  test("rejects values that are not integers", () => {
    expect(() => parseId("nope", "vendorId")).toThrow();
    expect(() => parseId(1.5, "productId")).toThrow();
    expect(() => parseId(undefined, "vendorId")).toThrow();
    expect(() => parseId(null, "productId")).toThrow();
  });
});
