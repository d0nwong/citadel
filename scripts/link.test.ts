import { expect, test } from "bun:test";
import { planLink } from "./link.ts";

const to = "/citadel/apps/argus";

test("planLink: a link into the old checkout moves", () => {
  expect(planLink("argus", "/p", to, { exists: true, link: "/old/argus" })).toEqual({
    from: "/old/argus", kind: "relink", path: "/p", to, what: "argus",
  });
});

test("planLink: a link already on citadel is kept, and a missing one is created", () => {
  expect(planLink("argus", "/p", to, { exists: true, link: to }).kind).toBe("keep");
  expect(planLink("argus", "/p", to, { exists: false, link: null })).toEqual({ kind: "create", path: "/p", to, what: "argus" });
});

test("planLink: a real directory with the same name is a conflict, never overwritten", () => {
  const a = planLink("skill ask", "/p", to, { exists: true, link: null });
  expect(a.kind).toBe("conflict");
});
