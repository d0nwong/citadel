import { describe, expect, test } from "bun:test";
import { FLOWS } from "./flows/index.ts";
import { ACTORS, DECOR } from "./model.ts";

test("every flow has its own id, and it works as a URL hash", () => {
  const ids = FLOWS.map((f) => f.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
});

for (const flow of FLOWS) {
  describe(flow.id, () => {
    const ids = new Set(flow.items.map((i) => i.id));
    const decor = new Set(flow.items.filter((i) => DECOR.has(i.kind)).map((i) => i.id));
    const boxes = flow.items.filter((i) => !DECOR.has(i.kind));

    test("every box has its own id", () => {
      expect(ids.size).toBe(flow.items.length);
    });

    test("every arrow joins two boxes that exist, and never a layout-only one", () => {
      for (const link of flow.links) {
        const name = `${link.from} → ${link.to}`;
        expect(ids.has(link.from), name).toBe(true);
        expect(ids.has(link.to), name).toBe(true);
        expect(decor.has(link.from) || decor.has(link.to), name).toBe(false);
      }
    });

    test("every box you can click has something to say, an actor the legend knows, and an arrow", () => {
      const linked = new Set(flow.links.flatMap((l) => [l.from, l.to]));
      for (const box of boxes) {
        expect(box.body?.trim(), box.id).toBeTruthy();
        expect(ACTORS[box.actor], box.id).toBeDefined();
        expect(linked.has(box.id), `${box.id} has no arrow`).toBe(true);
      }
    });

    test("it opens on a box you can click", () => {
      expect(boxes.some((b) => b.id === flow.first)).toBe(true);
    });
  });
}
