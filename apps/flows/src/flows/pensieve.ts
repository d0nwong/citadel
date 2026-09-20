/**
 * Pensieve, end to end: the reading room over the ledgers the sweep maintains, Ask beside
 * it, and the one narrow path every write takes. Three phases left to right, because the
 * rule that matters is the third one — Pensieve never edits a ledger itself.
 */

import type { Flow } from "../model.ts";

export const pensieve: Flow = {
  id: "pensieve",
  name: "Pensieve",
  title: "The reading room, and the one way it writes",
  lede: "Every page is a read of the ledgers the sweep keeps. Every click that changes something runs one argus verb, so it meets the same validator the command line does — and a refusal comes back as a sentence, never a crash. Only two writes leave the app: a ticket, and a job.",
  source: "apps/pensieve/src/server/ · apps/pensieve/src/lib/api.ts",
  labels: { claude: "Ask", data: "citadel-data", argus: "argus, as a subprocess" },
  first: "argusverb",
  // columns: reading at 10 / 380 / 780, Ask at 1140 / 1500, writing at 1900 / 2260
  items: [
    { id: "ph-read", kind: "phase", x: 10, y: -80, actor: "pensieve", title: "Reading the record", sub: "the feature is the unit" },
    { id: "rule-1", kind: "rule", x: 1080, y: -80, actor: "data", title: "" },
    { id: "ph-ask", kind: "phase", x: 1140, y: -80, actor: "claude", title: "Ask", sub: "Claude Code over the argus checkout" },
    { id: "rule-2", kind: "rule", x: 1840, y: -80, actor: "data", title: "" },
    { id: "ph-write", kind: "phase", x: 1900, y: -80, actor: "argus", title: "Writing", sub: "one verb, and the two writes that leave" },

    {
      id: "src-sweep", kind: "source", x: 10, y: -6, actor: "data", title: "The sweep's own files",
      path: ".git/sweep-status.json · .git/sweep.log", sub: "running · lastRunAt · nextRunAt",
      body: "Written by the sweep loop beside its lock, so git never sees them. This is what the top bar shows, and it is why a tick in progress is visible without asking the sweep anything.",
    },
    {
      id: "sweeplog", kind: "step", x: 780, y: 0, actor: "pensieve", title: "The sweep log", sub: "what the last tick did, live",
      body: "The tick's own streamed output, tee'd to a file by the loop. A tick running now is shown as it happens rather than only once it ends.",
    },
    {
      id: "src-data", kind: "source", x: 10, y: 134, actor: "data", title: "The ledgers",
      path: "<app>/features/<dir>/ledger.json · state/unplaced.json", sub: "the record the sweep maintains",
      body: "In the stack this directory is mounted rather than copied in, because it changes every sweep tick. Pensieve is a reader of it: the unplaced list is the sweep's own queue of what it could not attribute, and Home is where a person settles it.",
    },
    {
      id: "ledger", kind: "step", x: 380, y: 140, actor: "pensieve", title: "Read every ledger", sub: "and derive the three lists",
      body: "Reads each feature's ledger and argus's unplaced list, and derives what the front page shows. A ledger that will not parse is reported beside the ones that did, never thrown — one bad file must not take the page down.",
      rule: "Reads only. Nothing on this path writes anything.",
    },
    {
      id: "home", kind: "step", x: 380, y: 280, actor: "pensieve", title: "Home", sub: "three lists, then one line per feature",
      body: "The asks aimed at you that are not done, the tickets of yours with nothing left to wait for, and the messages the last runs could not place on any feature. The third list is the sweep's unplaced queue, and a click here is where a person settles it.",
    },
    {
      id: "feature", kind: "step", x: 380, y: 420, actor: "pensieve", title: "A feature's page", sub: "its ledger, in the order a founder asks",
      body: "The story, the asks with what happened to each, the tickets with their blockers, the proposals, the requirements with who confirmed them, and the landings.",
    },
    {
      id: "docs", kind: "step", x: 380, y: 560, actor: "pensieve", title: "The feature's docs", sub: "the spec and the arch doc",
      body: "The two tiers side by side: the reviewed spec that /scope revises and the sweep folds, and the arch doc the sweep refreshes when it drifts from the code.",
    },

    {
      id: "ask", kind: "step", x: 1140, y: 0, actor: "claude", title: "Ask", sub: "a question against the record",
      body: "Claude Code, configured to read the argus checkout and nothing more. Each conversation is one file, so it survives a restart. With no credential Ask reports itself off, with the reason, rather than failing when asked.",
      writes: ["PENSIEVE_HOME/conversations/<id>"],
    },
    {
      id: "f-conv", kind: "file", x: 1500, y: -6, actor: "data", title: "The conversation",
      path: "PENSIEVE_HOME/conversations/<id>", sub: "one file, kept",
      body: "On a volume in the stack, with Claude's own transcripts beside it, so a resumed conversation survives docker compose down and up.",
    },
    {
      id: "mode", kind: "step", x: 1140, y: 140, actor: "claude", title: "Which mode", sub: "container or local — per request",
      body: "In the container, the run has default permissions and a read-only allowlist, so the checkout is never touched: the per-run files land in it for the run's duration and are removed afterwards, leaving git status unchanged. On the host, the run has the operator's own credentials and bypassed permissions — exactly as a terminal session would — but never against the live checkouts.",
    },
    {
      id: "worktrees", kind: "step", x: 1140, y: 280, actor: "claude", title: "Cut the worktrees", sub: "local mode, on the first question",
      body: "One branch in two worktrees: citadel from its origin/main after a fetch, and citadel-data from its own local main — no fetch, because the sweep commits there and never pushes. The citadel worktree's argus directory is the sandbox; the citadel-data worktree is what the run reads as the record.",
      writes: ["PENSIEVE_HOME/worktrees/<id>/"],
    },
    {
      id: "rebase", kind: "step", x: 1140, y: 420, actor: "claude", title: "Rebase before each later question", sub: "so the answer is current",
      body: "The citadel-data branch is rebased onto main before every later question, so a ledger the sweep committed since last time is what the run reads. A conflict is left in the worktree and named, for the run itself to resolve.",
    },
    {
      id: "card", kind: "step", x: 1140, y: 560, actor: "claude", title: "It proposes; you click", sub: "a correction, or a new ticket",
      body: "Ask can offer a correction to the record or a drafted ticket, but it never writes one. The click on the card is what writes, and it goes through the same server function the pages call — so the answer and the page cannot disagree about what was checked.",
      rule: "The same checks refuse a draft here and on the page, so the sentence is the same either way.",
    },
    {
      id: "finish", kind: "step", x: 1140, y: 700, actor: "claude", title: "Finish", sub: "land the worktree, then discard it",
      body: "Commits the worktree's changed files through argus save, so only the record's files land and a path it refuses is left behind; fast-forwards the live checkout's main onto the branch, refusing rather than merging if main raced ahead; then removes the worktrees.",
    },

    {
      id: "argusverb", kind: "step", x: 1900, y: 0, actor: "argus", title: "One argus verb", sub: "the only way Pensieve writes",
      body: "Every write spawns argus's own script with --json, from argus's directory, pointed at the workspace, and reads the JSON it prints. A click therefore meets the same validator and the same correction functions the command line meets. Nothing else in the app touches a ledger or a state file.",
      rule: "A refusal comes back as data — ok: false and its problems — never as a crash, so the page can show the sentence you need.",
    },
    {
      id: "f-ledger", kind: "file", x: 2260, y: -6, actor: "data", title: "The ledger, corrected",
      path: "<app>/features/<dir>/ledger.json", sub: "written by the verb, never by the app",
      body: "The same file the sweep writes, through the same validator. A tick and a click cannot disagree about what a valid ledger is.",
    },
    {
      id: "ticket", kind: "step", x: 1900, y: 140, actor: "linear", title: "File a ticket", sub: "the first write that leaves",
      body: "A draft is routed by its team: a Citadel draft files on Linear, an alden-portal one on the Alden board. Without that provider's credential the draft is still checked against the last project list Pensieve cached, and File is shown off with the reason rather than hidden.",
    },
    {
      id: "send", kind: "step", x: 1900, y: 280, actor: "foundry", title: "Send to Foundry", sub: "the second write that leaves",
      body: "POST /api/jobs with the ticket key as the idempotency key, so the same ticket sent twice replays rather than queues twice. Nobody names a blueprint unless a person picked one, which is what lets Foundry route a ticket-driven job itself.",
      rule: "Only a ticket nothing has started on — Backlog or Todo — can be sent. With no Foundry token, Send is shown off with the reason.",
    },
    {
      id: "recorded", kind: "step", x: 1900, y: 420, actor: "argus", title: "Record the send", sub: "argus sent, on the feature's ledger",
      body: "The job is recorded on the ledger through a verb, like every other write. A ticket that sits on no ledger has no feature to record it against, so the row says the send was not recorded there rather than calling the verb with an empty feature.",
    },
  ],
  links: [
    { from: "src-sweep", to: "sweeplog", in: "l", dashed: true },
    { from: "src-data", to: "ledger", in: "l", dashed: true },
    { from: "ledger", to: "home" },
    { from: "ledger", to: "sweeplog", out: "r", in: "b", dashed: true },
    { from: "home", to: "feature" },
    { from: "feature", to: "docs" },
    { from: "feature", to: "ask", out: "r", in: "l", tone: "claude" },

    { from: "ask", to: "f-conv", out: "r", in: "l" },
    { from: "ask", to: "mode" },
    { from: "mode", to: "worktrees" },
    { from: "worktrees", to: "rebase" },
    { from: "rebase", to: "card" },
    { from: "card", to: "finish" },
    { from: "card", to: "argusverb", out: "r", in: "l", tone: "argus" },
    { from: "finish", to: "argusverb", out: "r", in: "b", dashed: true, label: "argus save" },
    { from: "home", to: "argusverb", out: "r", in: "l", dashed: true, label: "a click that changes something" },

    { from: "argusverb", to: "f-ledger", out: "r", in: "l" },
    { from: "argusverb", to: "ticket" },
    { from: "ticket", to: "send" },
    { from: "send", to: "recorded" },
  ],
};
