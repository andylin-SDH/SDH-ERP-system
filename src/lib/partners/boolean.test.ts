import { describe, expect, it } from "vitest";
import { normalizePartnerBoolean } from "./boolean";

describe("normalizePartnerBoolean", () => {
  it("treats string false as false", () => {
    expect(normalizePartnerBoolean("false")).toBe(false);
    expect(normalizePartnerBoolean("否")).toBe(false);
  });

  it("treats truthy strings as true", () => {
    expect(normalizePartnerBoolean("true")).toBe(true);
    expect(normalizePartnerBoolean("是")).toBe(true);
  });

  it("handles boolean and null", () => {
    expect(normalizePartnerBoolean(true)).toBe(true);
    expect(normalizePartnerBoolean(false)).toBe(false);
    expect(normalizePartnerBoolean(null)).toBe(false);
  });
});
