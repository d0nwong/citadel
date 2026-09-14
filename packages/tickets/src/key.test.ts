import { describe, expect, test } from "bun:test";
import { providerNameFor, providerNameForTeam, splitKey } from "./key.ts";

describe("splitKey", () => {
  test("a key splits into team and number; anything else is null", () => {
    expect(splitKey("ALD-45")).toEqual(["ALD", 45]);
    expect(splitKey("CTD-179")).toEqual(["CTD", 179]);
    expect(splitKey("fe#437")).toBeNull();
    expect(splitKey("ald-45")).toBeNull();
  });
});

describe("providerNameFor", () => {
  test("ALD and CTD route to Linear, AP to Trello", () => {
    expect(providerNameFor("ALD-45")).toBe("linear");
    expect(providerNameFor("CTD-179")).toBe("linear");
    expect(providerNameFor("AP-12")).toBe("trello");
  });
  test("a team no provider owns, and anything that is not a ticket key, route nowhere", () => {
    expect(providerNameFor("LIA-1")).toBeNull();
    expect(providerNameFor("fe#437")).toBeNull();
  });
});

describe("providerNameForTeam", () => {
  test("the same table, keyed by a bare team — no ticket number to split off", () => {
    expect(providerNameForTeam("ALD")).toBe("linear");
    expect(providerNameForTeam("CTD")).toBe("linear");
    expect(providerNameForTeam("AP")).toBe("trello");
    expect(providerNameForTeam("LIA")).toBeNull();
  });
});
