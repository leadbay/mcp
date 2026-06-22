import { describe, it, expect } from "vitest";
import { sanitizeConfigForType } from "../../../src/tools/_custom-field-config.js";

// Guards the fix for the live "JSON deserialization error" (500) on custom-field
// create/update: the backend's per-type config models are strict, so any extra
// key must be stripped before sending. Especially on a type CHANGE where the
// previous config carries keys the new type rejects.
describe("sanitizeConfigForType", () => {
  it("PRICE — keeps only currency, drops extra keys", () => {
    expect(
      sanitizeConfigForType("PRICE", { currency: "EUR", format: null, url_template: "x" })
    ).toEqual({ currency: "EUR" });
  });

  it("PRICE — no currency → null (caller omits config; backend 400s with a clear message)", () => {
    expect(sanitizeConfigForType("PRICE", { format: null })).toBeNull();
  });

  it("DATE / DATETIME — keeps only format (nullable)", () => {
    expect(sanitizeConfigForType("DATE", { format: "yyyy-MM-dd", currency: "EUR" })).toEqual({
      format: "yyyy-MM-dd",
    });
    expect(sanitizeConfigForType("DATETIME", { format: null })).toEqual({ format: null });
  });

  it("EXTERNAL_ID — normalizes url_template / urlTemplate to snake_case wire key only", () => {
    expect(
      sanitizeConfigForType("EXTERNAL_ID", { urlTemplate: "https://x/{value}", currency: "EUR" })
    ).toEqual({ url_template: "https://x/{value}" });
    expect(
      sanitizeConfigForType("EXTERNAL_ID", { url_template: "https://y/{value}" })
    ).toEqual({ url_template: "https://y/{value}" });
  });

  it("TEXT / NUMBER — never carry config", () => {
    expect(sanitizeConfigForType("TEXT", { currency: "EUR" })).toBeNull();
    expect(sanitizeConfigForType("NUMBER", { format: "x" })).toBeNull();
  });

  it("null / undefined config → null", () => {
    expect(sanitizeConfigForType("PRICE", null)).toBeNull();
    expect(sanitizeConfigForType("PRICE", undefined)).toBeNull();
  });

  it("unknown type → null (no config forwarded)", () => {
    expect(sanitizeConfigForType("WEIRD" as any, { currency: "EUR" })).toBeNull();
  });

  it("STRINGIFIED config — parses it (LLMs pass nested JSON as a string)", () => {
    // The exact shape observed live: agent sent config as a JSON string with
    // an extra `code` key. Must parse + narrow to {currency}.
    expect(
      sanitizeConfigForType("PRICE", '{"currency":"EUR","code":"EUR"}' as any)
    ).toEqual({ currency: "EUR" });
    expect(
      sanitizeConfigForType("EXTERNAL_ID", '{"url_template":"https://x/{value}"}' as any)
    ).toEqual({ url_template: "https://x/{value}" });
  });

  it("unparseable string → null", () => {
    expect(sanitizeConfigForType("PRICE", "not json" as any)).toBeNull();
  });
});
