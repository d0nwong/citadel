/**
 * `propose_decision` over the ledger. It answers one of the four things a person does to
 * the record — close an ask, confirm or contradict a requirement, place an unplaced
 * message — and the point of every test is the same: the tool writes nothing. It checks
 * against the record and answers a proposal or a refusal in the pages' own words.
 */

import { describe, expect, test } from "bun:test";
import type { Ledger, Unplaced } from "../lib/ledger";
import { proposeDecision } from "./ask-tools.server";
import type { LedgerRef } from "./ledger";

const FIXTURE = new URL("../test/fixtures/ledger.json", import.meta.url)
  .pathname;
const ledger = async (): Promise<Ledger> => Bun.file(FIXTURE).json();

const sources = async () => {
  const l = await ledger();
  const refs: LedgerRef[] = [
    {
      app: "alden/alden-portal",
      dir: "admin/invoicing",
      feature: "alden/alden-portal/admin/invoicing",
      ledger: l,
    },
  ];
  const unplaced: Unplaced[] = [
    {
      at: "2026-09-11",
      batch: "b",
      by: "Sam O",
      candidates: ["tasks"],
      id: "1789000000.000001",
      kind: "message",
      text: "Sam asks whether the subtask rows keep their own price",
      url: "u",
    },
  ];
  return { ledgers: async () => refs, unplaced: async () => unplaced };
};

describe("close", () => {
  test("an open ask is proposed with its own text as the subject", async () => {
    const out = await proposeDecision(
      {
        feature: "admin/invoicing",
        id: "A-2",
        reason: "answered in the standup",
        verb: "close",
      },
      {},
      await sources()
    );
    expect(out).toMatchObject({
      ok: true,
      proposal: {
        feature: "admin/invoicing",
        id: "A-2",
        subject: expect.stringContaining("Sam asked you and Carlos"),
        verb: "close",
      },
    });
  });
  test("a closed ask, an unknown ask and a missing reason are refused in words", async () => {
    const s = await sources();
    expect(
      !(
        await proposeDecision(
          { feature: "admin/invoicing", id: "A-1", reason: "x", verb: "close" },
          {},
          s
        )
      ).ok
    ).toBe(true);
    const unknown = await proposeDecision(
      { feature: "admin/invoicing", id: "A-9", reason: "x", verb: "close" },
      {},
      s
    );
    expect(!unknown.ok && unknown.error).toContain("no ask A-9");
    const noReason = await proposeDecision(
      { feature: "admin/invoicing", id: "A-2", verb: "close" },
      {},
      s
    );
    expect(!noReason.ok && noReason.error).toContain("how it got done");
  });
});

describe("confirm and contradict", () => {
  test("an assumed rule can be confirmed; a confirmed one cannot be confirmed again but can be contradicted", async () => {
    const s = await sources();
    expect(
      await proposeDecision(
        {
          feature: "admin/invoicing",
          id: "R-3",
          reason: "Foong said so",
          verb: "confirm",
        },
        {},
        s
      )
    ).toMatchObject({ ok: true, proposal: { id: "R-3", verb: "confirm" } });
    expect(
      !(
        await proposeDecision(
          {
            feature: "admin/invoicing",
            id: "R-1",
            reason: "x",
            verb: "confirm",
          },
          {},
          s
        )
      ).ok
    ).toBe(true);
    expect(
      await proposeDecision(
        {
          feature: "admin/invoicing",
          id: "R-1",
          reason: "Foong reversed it",
          verb: "contradict",
        },
        {},
        s
      )
    ).toMatchObject({ ok: true, proposal: { id: "R-1", verb: "contradict" } });
  });
  test("an unknown feature is refused with what a feature looks like", async () => {
    const out = await proposeDecision(
      { feature: "Invoicing", id: "R-1", reason: "x", verb: "confirm" },
      {},
      await sources()
    );
    expect(!out.ok && out.error).toContain("admin/usage");
  });
});

describe("place", () => {
  test("an unplaced message onto a feature needs no reason; an unknown id says where to look", async () => {
    const s = await sources();
    expect(
      await proposeDecision(
        { feature: "admin/invoicing", id: "1789000000.000001", verb: "place" },
        {},
        s
      )
    ).toMatchObject({
      ok: true,
      proposal: {
        subject: expect.stringContaining("subtask rows"),
        verb: "place",
      },
    });
    const out = await proposeDecision(
      { feature: "admin/invoicing", id: "nope", verb: "place" },
      {},
      s
    );
    expect(!out.ok && out.error).toContain("state/unplaced.json");
  });
});

test.each(["attach", "dismiss", "send", "new"])(
  "%p is not a verb",
  async (verb) => {
    const out = await proposeDecision(
      { feature: "admin/invoicing", id: "A-2", verb },
      {},
      await sources()
    );
    expect(!out.ok && out.error).toContain("propose_decision:");
  }
);
