import { describe, expect, test } from "bun:test";
import { providerNameFor, splitKey } from "./key.ts";

describe("splitKey", () => {
  test("a key splits into team and number; anything else is null", () => {
    expect(splitKey("ALD-45")).toEqual(["ALD", 45]);
    expect(splitKey("CTD-179")).toEqual(["CTD", 179]);
    expect(splitKey("fe#437")).toBeNull();
    expect(splitKey("ald-45")).toBeNull();
  });
});

describe("providerNameFor", () => {
  test("ALD and CTD route to Linear", () => {
    expect(providerNameFor("ALD-45")).toBe("linear");
    expect(providerNameFor("CTD-179")).toBe("linear");
  });
  test("a team no provider owns, and anything that is not a ticket key, route nowhere", () => {
    expect(providerNameFor("AP-12")).toBeNull();
    expect(providerNameFor("LIA-1")).toBeNull();
    expect(providerNameFor("fe#437")).toBeNull();
  });
});
