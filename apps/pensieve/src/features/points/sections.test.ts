import { describe, expect, test } from "bun:test";
import { primaryAction, sectionOf, waitingTag } from "./sections";

describe("sectionOf — five groups, three sections", () => {
  test.each([
    ["decide", "act"],
    ["verify", "act"],
    ["confirm", "waiting"],
    ["hold", "waiting"],
    ["housekeeping", "housekeeping"],
  ] as const)("%s → %s", (group, section) =>
    expect(sectionOf({ group })).toBe(section)
  );
});

describe("waitingTag", () => {
  test("a Confirm point's ask is the name", () => {
    expect(waitingTag({ ask: "Sam", group: "confirm" })).toBe("with Sam");
    expect(waitingTag({ ask: "  ", group: "confirm" })).toBe("with someone");
  });
  test("a hold's ask is already the clause", () => {
    expect(
      waitingTag({ ask: "waits on Auth0 tenant settings", group: "hold" })
    ).toBe("waits on Auth0 tenant settings");
    expect(waitingTag({ ask: "", group: "hold" })).toBe("on hold");
  });
  test("acting rows wear none", () => {
    expect(waitingTag({ ask: "send to Foundry?", group: "decide" })).toBe(
      undefined
    );
    expect(waitingTag({ ask: "x", group: "housekeeping" })).toBe(undefined);
  });
});

describe("primaryAction", () => {
  test("Verify leads with Approve whatever else it has", () => {
    expect(primaryAction({ group: "verify", ticket: "LIA-1" }, true)).toBe(
      "approve"
    );
    expect(primaryAction({ group: "verify" }, false)).toBe("approve");
  });
  test("a Decide point's ticket leads with Send only while Foundry is configured; a waiting row never leads", () => {
    expect(primaryAction({ group: "decide", ticket: "LIA-1" }, true)).toBe(
      "send"
    );
    expect(primaryAction({ group: "decide", ticket: "LIA-1" }, false)).toBe(
      undefined
    );
    expect(primaryAction({ group: "confirm", ticket: "LIA-1" }, true)).toBe(
      undefined
    );
    expect(primaryAction({ group: "hold", ticket: "LIA-1" }, true)).toBe(
      undefined
    );
  });
  test("no ticket, no lead", () => {
    expect(primaryAction({ group: "decide" }, true)).toBe(undefined);
  });
});
