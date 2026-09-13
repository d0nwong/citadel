import { describe, expect, test } from "bun:test";
import { ACTORS, DECOR, FIRST, ITEMS, LINKS } from "./flow.ts";

const ids = new Set(ITEMS.map((i) => i.id));

describe("the map", () => {
  test("every box has its own id", () => {
    expect(ids.size).toBe(ITEMS.length);
  });

  test("every arrow joins two boxes that exist, and never a layout-only one", () => {
    const decor = new Set(ITEMS.filter((i) => DECOR.has(i.kind)).map((i) => i.id));
    for (const link of LINKS) {
      expect(ids.has(link.from), `${link.from} → ${link.to}`).toBe(true);
      expect(ids.has(link.to), `${link.from} → ${link.to}`).toBe(true);
      expect(decor.has(link.from) || decor.has(link.to), `${link.from} → ${link.to}`).toBe(false);
    }
  });

  test("every box you can click has something to say, and an actor the legend knows", () => {
    for (const item of ITEMS.filter((i) => !DECOR.has(i.kind))) {
      expect(item.body?.trim(), item.id).toBeTruthy();
      expect(ACTORS[item.actor], item.id).toBeDefined();
    }
  });

  // the doubt pass and a dropped revision are side exits: findings go back into the artifact, a drop ends the revision
  const SIDE_EXITS = new Set(["doubt", "drop"]);

  test("every box but the ramble is reached by an arrow, and every one leads somewhere", () => {
    const into = new Set(LINKS.map((l) => l.to));
    const out = new Set(LINKS.map((l) => l.from));
    for (const item of ITEMS.filter((i) => !DECOR.has(i.kind))) {
      if (item.id !== "in" && item.kind !== "source") expect(into.has(item.id), `nothing reaches ${item.id}`).toBe(true);
      if (item.kind === "step" || item.kind === "gate") expect(out.has(item.id) || SIDE_EXITS.has(item.id), `${item.id} leads nowhere`).toBe(true);
    }
  });

  test("the page opens on a box that exists", () => {
    expect(ids.has(FIRST)).toBe(true);
  });
});
