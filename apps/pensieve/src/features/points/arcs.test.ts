/**
 * Grouping the queue by arc, and the join behind an arc page's Open list (LIA-149 AC5, AC2).
 * The rule that matters in both: an arc never invents a membership — the point's own `arc`
 * field, written by the sweep from the arc's seeds (LIA-148), and the point ids the arc file
 * itself names are the only two ways in.
 */

import { describe, expect, test } from "bun:test";
import type { Point } from "#/server/workspace";
import { byArc, NO_ARC, openPointsOf, otherOpenRows } from "./arcs";

const point = (id: string, over: Partial<Point> = {}): Point => ({
  ask: "send to Foundry?",
  firstSeen: "2026-09-08",
  group: "decide",
  id,
  subject: id,
  ...over,
});

const arcs = [
  { slug: "invoice-emails", title: "Invoice emails" },
  { slug: "entity-billing", title: "Entity billing" },
];

describe("byArc — the queue's headings (AC5)", () => {
  test("no point carries an arc: no partition at all, and today's layout", () => {
    expect(byArc([point("decide/a"), point("verify/b")], arcs)).toBeNull();
    expect(byArc([], arcs)).toBeNull();
  });

  test("one group per arc, in the order the arcs were given", () => {
    const groups = byArc(
      [
        point("decide/a", { arc: "entity-billing" }),
        point("verify/b", { arc: "invoice-emails" }),
        point("decide/c", { arc: "entity-billing" }),
      ],
      arcs
    );
    expect(groups?.map((g) => g.ref?.title)).toEqual([
      "Invoice emails",
      "Entity billing",
    ]);
    expect(groups?.[1].points.map((p) => p.id)).toEqual([
      "decide/a",
      "decide/c",
    ]);
  });

  test("unarced points sit under their own group, last", () => {
    const groups = byArc(
      [point("decide/a"), point("verify/b", { arc: "invoice-emails" })],
      arcs
    );
    expect(groups?.map((g) => g.ref?.title ?? NO_ARC)).toEqual([
      "Invoice emails",
      NO_ARC,
    ]);
    expect(groups?.at(-1)?.points.map((p) => p.id)).toEqual(["decide/a"]);
  });

  test("an arc the list does not name keeps its slug and follows the named ones", () => {
    const groups = byArc(
      [
        point("decide/a", { arc: "closed-since-the-tick" }),
        point("verify/b", { arc: "invoice-emails" }),
        point("decide/c"),
      ],
      arcs
    );
    expect(groups?.map((g) => g.ref?.title ?? NO_ARC)).toEqual([
      "Invoice emails",
      "closed-since-the-tick",
      NO_ARC,
    ]);
  });

  test("every point comes out exactly once", () => {
    const points = [
      point("decide/a", { arc: "invoice-emails" }),
      point("decide/b", { arc: "nowhere" }),
      point("decide/c"),
      point("decide/d", { arc: "invoice-emails" }),
    ];
    const groups = byArc(points, arcs) ?? [];
    expect(groups.flatMap((g) => g.points.map((p) => p.id)).sort()).toEqual([
      "decide/a",
      "decide/b",
      "decide/c",
      "decide/d",
    ]);
  });
});

describe("openPointsOf — an arc page's live Open rows (AC2)", () => {
  const open = [
    { point: "decide/lia-134", text: "**LIA-134** → reopen it?" },
    { text: "LIA-140 — client name → open in Linear" },
  ];

  test("the file's rows first, in the file's order, then anything filed since", () => {
    const points = [
      point("decide/later", { arc: "invoice-emails" }),
      point("decide/lia-134"),
    ];
    expect(
      openPointsOf("invoice-emails", open, points).map((p) => p.id)
    ).toEqual(["decide/lia-134", "decide/later"]);
  });

  test("a point decided since the file was written is dropped, not shown with controls", () => {
    const points = [
      point("decide/lia-134", {
        decision: {
          action: "sent",
          at: "2026-09-09T10:00:00.000Z",
          point: "decide/lia-134",
          subject: "LIA-134",
        },
      }),
    ];
    expect(openPointsOf("invoice-emails", open, points)).toEqual([]);
  });

  test("a point named by both the file and its own arc field appears once", () => {
    const points = [point("decide/lia-134", { arc: "invoice-emails" })];
    expect(
      openPointsOf("invoice-emails", open, points).map((p) => p.id)
    ).toEqual(["decide/lia-134"]);
  });

  test("another arc's point is never pulled in", () => {
    const points = [point("decide/other", { arc: "entity-billing" })];
    expect(openPointsOf("invoice-emails", [], points)).toEqual([]);
  });

  test("the rows no live point stands for are what is left to render as text", () => {
    const points = [point("decide/lia-134")];
    const shown = openPointsOf("invoice-emails", open, points);
    expect(otherOpenRows(open, shown)).toEqual([
      { text: "LIA-140 — client name → open in Linear" },
    ]);
  });
});
