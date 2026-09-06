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
import type { Decision } from "./decisions";
import {
  decisionPath,
  isPointId,
  mergeDecisions,
  parseDecision,
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
