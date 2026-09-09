import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPointId } from "../lib/points";
import type { ArcDecision, Decision } from "./decisions";
import {
  decisionPath,
  isArcDecision,
  mergeDecisions,
  parseDecision,
  readArcDecision,
  readDecision,
  readDecisions,
  writeDecision,
} from "./decisions";
import type { Point } from "./workspace";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pensieve-decisions-"));
});
afterEach(() => rm(dir, { force: true, recursive: true }));

const point = (id: string, extra: Partial<Point> = {}): Point => ({
  ask: "A",
  firstSeen: "2026-09-05",
  group: id.split("/")[0] as Point["group"],
  id,
  subject: "S",
  ...extra,
});

describe("AC9 — the writer refuses anything outside decisions/", () => {
  test("a well-formed id maps to decisions/<group>/<slug>.json", () => {
    expect(decisionPath("decide/lia-86", dir)).toBe(
      join(dir, "decide", "lia-86.json")
    );
  });
  test.each([
    "../etc/passwd",
    "decide/../../x",
    "/decide/x",
    "decide/x/y",
    "reports/points",
    "decide/",
    "decide/UPPER",
    "decide/a b",
    "decide/-leading",
    "",
  ])("refuses %j", (id) => {
    expect(isPointId(id)).toBe(false);
    expect(() => decisionPath(id, dir)).toThrow(/refused/);
  });
});

describe("AC2 / AC4 — atomic write of the decision file", () => {
  test("ignored: file has point, action, reason, at, subject and nothing half-written", async () => {
    const d: Decision = {
      action: "ignored",
      at: "2026-09-05T10:00:00.000Z",
      point: "decide/lia-86",
      reason: "not now",
      subject: "LIA-86",
    };
    const target = await writeDecision(d, dir);
    expect(target).toBe(join(dir, "decide", "lia-86.json"));
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual(d);
    // no temp file left behind
    expect((await readdir(join(dir, "decide"))).sort()).toEqual([
      "lia-86.json",
    ]);
  });
  test("sent: carries job { id, url } and no reason key", async () => {
    const d: Decision = {
      action: "sent",
      at: "2026-09-05T10:00:00.000Z",
      job: { id: "abc", url: "http://localhost:3777/" },
      point: "verify/lia-78",
      subject: "LIA-78",
    };
    await writeDecision(d, dir);
    const raw = JSON.parse(
      await readFile(join(dir, "verify", "lia-78.json"), "utf8")
    );
    expect(raw).toEqual(d);
    expect("reason" in raw).toBe(false);
  });
  test("verified with no note: no reason key, nothing half-written (LIA-115 AC2)", async () => {
    const d: Decision = {
      action: "verified",
      at: "2026-09-07T10:00:00.000Z",
      point: "verify/lia-78-appears-implemented",
      subject: "LIA-78",
    };
    const target = await writeDecision(d, dir);
    expect(target).toBe(join(dir, "verify", "lia-78-appears-implemented.json"));
    const raw = JSON.parse(await readFile(target, "utf8"));
    expect(raw).toEqual(d);
    // A confirmation needs no argument — the key is absent, not empty.
    expect("reason" in raw).toBe(false);
    expect((await readdir(join(dir, "verify"))).sort()).toEqual([
      "lia-78-appears-implemented.json",
    ]);
  });
  test("verified with a note carries it as reason (LIA-115 AC2)", async () => {
    await writeDecision(
      {
        action: "verified",
        at: "2026-09-07T10:00:00.000Z",
        point: "verify/lia-71-history-rollup",
        reason: "correct — the Pending bullet is satisfied",
        subject: "LIA-71",
      },
      dir
    );
    const raw = JSON.parse(
      await readFile(join(dir, "verify", "lia-71-history-rollup.json"), "utf8")
    );
    expect(raw.reason).toBe("correct — the Pending bullet is satisfied");
  });
  test("the sweep would accept what is written (same rules as points.ts parseDecision)", async () => {
    await writeDecision(
      {
        action: "ignored",
        at: "t",
        point: "decide/x",
        reason: "why",
        subject: "s",
      },
      dir
    );
    expect(
      parseDecision(await readFile(join(dir, "decide", "x.json"), "utf8"))
    ).toMatchObject({ action: "ignored", point: "decide/x" });
    expect(parseDecision('{"point":"decide/x","action":"ignored"}')).toBeNull(); // reason required
    expect(parseDecision('{"point":"decide/x","action":"maybe"}')).toBeNull();
    expect(parseDecision("nope")).toBeNull();

    // LIA-115 AC7 — the third verb, whose `reason` is optional (argus points.ts:parseDecision).
    await writeDecision(
      { action: "verified", at: "t", point: "verify/y", subject: "s" },
      dir
    );
    expect(
      parseDecision(await readFile(join(dir, "verify", "y.json"), "utf8"))
    ).toMatchObject({ action: "verified", point: "verify/y" });
    expect(
      parseDecision('{"point":"verify/y","action":"verified"}')
    ).toMatchObject({ action: "verified" });
    expect(
      parseDecision('{"point":"verify/y","action":"verified","reason":"why"}')
    ).toMatchObject({ action: "verified", reason: "why" });
    // The verb is not restricted to the Verify group by the reader (LIA-114 AC2).
    expect(
      parseDecision('{"point":"decide/z","action":"verified"}')
    ).toMatchObject({ action: "verified", point: "decide/z" });
  });
});

describe("AC8 — files on disk win over the sweep’s copy", () => {
  test("readDecisions keys by point, ignores temp files, later at wins", async () => {
    await mkdir(join(dir, "decide"), { recursive: true });
    await writeFile(
      join(dir, "decide", "a.json"),
      JSON.stringify({
        action: "ignored",
        at: "2026-09-05T01:00:00Z",
        point: "decide/a",
        reason: "r",
        subject: "a",
      })
    );
    await writeFile(
      join(dir, "decide", "a-again.json"),
      JSON.stringify({
        action: "sent",
        at: "2026-09-05T02:00:00Z",
        job: { id: "j", url: "u" },
        point: "decide/a",
        subject: "a",
      })
    );
    await writeFile(
      join(dir, "decide", ".b.json.tmp-1234"),
      JSON.stringify({
        action: "ignored",
        at: "",
        point: "decide/b",
        reason: "half",
        subject: "b",
      })
    );
    await writeFile(join(dir, "decide", "broken.json"), "{");
    const m = await readDecisions(dir);
    expect([...m.keys()]).toEqual(["decide/a"]);
    expect(m.get("decide/a")?.action).toBe("sent");
  });
  test("mergeDecisions attaches the file even when points.json has no decision yet", async () => {
    await writeDecision(
      {
        action: "ignored",
        at: "t",
        point: "decide/a",
        reason: "r",
        subject: "a",
      },
      dir
    );
    const merged = mergeDecisions(
      [point("decide/a"), point("decide/b")],
      await readDecisions(dir)
    );
    expect(merged[0].decision?.action).toBe("ignored");
    expect(merged[1].decision).toBeUndefined();
  });
  test("readDecision returns null for an undecided point and the file for a decided one", async () => {
    expect(await readDecision("decide/none", dir)).toBeNull();
    await writeDecision(
      {
        action: "ignored",
        at: "t",
        point: "decide/one",
        reason: "r",
        subject: "one",
      },
      dir
    );
    expect((await readDecision("decide/one", dir))?.reason).toBe("r");
  });
});

describe("LIA-147 — the arc group travels the same path and joins no point", () => {
  const seeds = {
    features: ["alden/invoicing"],
    prs: [],
    rules: ["BR-22h"],
    tickets: ["LIA-133"],
  };
  const opened: ArcDecision = {
    action: "opened",
    at: "2026-09-09T09:00:00.000Z",
    point: "arc/invoice-emails",
    seeds,
    slug: "invoice-emails",
    subject: "Invoice emails",
  };

  test("an arc id maps to decisions/arc/<slug>.json, and a bad one is still refused", () => {
    expect(decisionPath("arc/invoice-emails", dir)).toBe(
      join(dir, "arc", "invoice-emails.json")
    );
    for (const id of ["arc/../x", "arc/UPPER", "arc/", "arc/a b"]) {
      expect(() => decisionPath(id, dir)).toThrow(/refused/);
    }
  });

  test("opened: the file carries the seeds and no slug key, and reads back", async () => {
    const target = await writeDecision(opened, dir);
    expect(target).toBe(join(dir, "arc", "invoice-emails.json"));
    const raw = JSON.parse(await readFile(target, "utf8"));
    expect(raw).toEqual({
      action: "opened",
      at: opened.at,
      point: "arc/invoice-emails",
      seeds,
      subject: "Invoice emails",
    });
    expect(await readArcDecision("invoice-emails", dir)).toEqual(opened);
    expect((await readdir(join(dir, "arc"))).sort()).toEqual([
      "invoice-emails.json",
    ]);
  });

  test("closed: the same path, the same writer, the status the sweep reads", async () => {
    await writeDecision(opened, dir);
    await writeDecision(
      {
        action: "closed",
        at: "2026-09-20T09:00:00.000Z",
        point: "arc/invoice-emails",
        reason: "shipped",
        seeds: { features: [], prs: [], rules: [], tickets: [] },
        slug: "invoice-emails",
        subject: "Invoice emails",
      },
      dir
    );
    const closed = await readArcDecision("invoice-emails", dir);
    expect(closed).toMatchObject({ action: "closed", reason: "shipped" });
    expect((await readdir(join(dir, "arc"))).sort()).toEqual([
      "invoice-emails.json",
    ]);
  });

  test("the sweep's parseArcDecision rules, restated: seeds required on opened", () => {
    const arc = (body: Record<string, unknown>) =>
      parseDecision(JSON.stringify(body));
    expect(
      arc({ action: "opened", point: "arc/x", seeds: { tickets: ["LIA-1"] } })
    ).toMatchObject({
      action: "opened",
      slug: "x",
    });
    // An arc with no keys files nothing, so the file is not one the sweep would accept.
    expect(arc({ action: "opened", point: "arc/x" })).toBeNull();
    expect(arc({ action: "opened", point: "arc/x", seeds: {} })).toBeNull();
    // `closed` only flips the status of an arc that exists — seeds are not its substance.
    expect(arc({ action: "closed", point: "arc/x" })).toMatchObject({
      action: "closed",
    });
    expect(arc({ action: "ignored", point: "arc/x", reason: "no" })).toBeNull();
    expect(
      arc({
        action: "opened",
        point: "decide/x",
        seeds: { tickets: ["LIA-1"] },
      })
    ).toBeNull();
  });

  test("AC5 — an arc file is neither a verdict on a point nor an unreadable one", async () => {
    await writeDecision(opened, dir);
    await writeDecision(
      {
        action: "ignored",
        at: "2026-09-09T10:00:00.000Z",
        point: "decide/lia-86",
        reason: "not now",
        subject: "LIA-86",
      },
      dir
    );
    const onDisk = await readDecisions(dir);
    expect([...onDisk.keys()]).toEqual(["decide/lia-86"]);
    // A point that happened to share the id would still not be merged from an arc file.
    expect(await readDecision("arc/invoice-emails", dir)).toBeNull();
    const arc = await readArcDecision("invoice-emails", dir);
    expect(arc && isArcDecision(arc)).toBe(true);
  });
});
