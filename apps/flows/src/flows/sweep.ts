/**
 * One sweep tick, end to end: the loop that starts it, the eight steps the /sweep session
 * runs, and the single commit that closes it. Three phases left to right, because the
 * boundary between bash, the model and the argus verbs is what keeps a tick repeatable.
 */

import type { Flow } from "../model.ts";

export const sweep: Flow = {
  id: "sweep",
  name: "Sweep",
  title: "Every fifteen minutes, the record catches up",
  lede: "A locked tick pulls what landed and what was said, places it on the features that own it, lets a reader and a grounder write to the ledgers, reconciles against the trackers, refreshes the stale docs, and closes with one commit. No step remembers anything: the files decide what runs.",
  source: "apps/argus/infra/sweep/loop.sh · apps/argus/skills/sweep/SKILL.md · scripts/argus/",
  labels: { claude: "the /sweep session", sweep: "the sweep loop", data: "citadel-data" },
  first: "run",
  // columns: loop at 10 / 380 / 780, the tick at 1140 / 1500, closing at 1900 / 2260
  items: [
    { id: "ph-loop", kind: "phase", x: 10, y: -80, actor: "sweep", title: "The loop", sub: "bash, in the stack — one tick per SWEEP_INTERVAL" },
    { id: "rule-1", kind: "rule", x: 1080, y: -80, actor: "data", title: "" },
    { id: "ph-tick", kind: "phase", x: 1140, y: -230, actor: "claude", title: "The tick", sub: "eight steps, each one argus or accio verb" },
    { id: "rule-2", kind: "rule", x: 1840, y: -80, actor: "data", title: "" },
    { id: "ph-close", kind: "phase", x: 1900, y: -80, actor: "argus", title: "Closing the tick", sub: "one commit, then the cursor moves" },

    {
      id: "svc", kind: "step", x: 380, y: 0, actor: "sweep", title: "The sweep service", sub: "compose, behind a profile",
      body: "A bare docker compose up leaves the sweep off; just up names the profile only after a preflight check that no host loop is already writing. A sweep in the stack while the host's /loop 15m /sweep runs would be two writers on one data repo.",
      rule: "SWEEP_INTERVAL defaults to 900s. The data repo is mounted at /argus-data.",
    },
    {
      id: "lock", kind: "step", x: 380, y: 140, actor: "sweep", title: "Take the lock", sub: "never two at once",
      body: "flock on a lock file inside the data repo's own .git, so every container sharing that data repo shares the lock and git status never shows it. A tick due while another holds it is skipped, not queued.",
    },
    {
      id: "src-projects", kind: "source", x: 10, y: 274, actor: "data", title: "projects.json",
      path: "citadel-data/projects.json", sub: "the projects, their repos, their channels, their jobs",
      body: "The one file that says what exists. A project, repo or channel added here is picked up by the next tick with no change to the sweep's code, image or compose file — and it is not on the allowlist the sweep may commit, so the sweep reads it and never writes it back.",
    },
    {
      id: "sync", kind: "step", x: 380, y: 280, actor: "sweep", title: "Refresh the checkouts", sub: "clone or fetch every repo named",
      body: "Each product repo is cloned or fetched into the container's shared checkout directory. A repo it cannot reach is recorded rather than guessed at, so a later step never reads a stale tree and calls it current.",
      writes: [".git/sweep-tick-unreachable.json — rewritten fresh each tick"],
    },
    {
      id: "tickstart", kind: "step", x: 1140, y: -140, actor: "argus", title: "1 · argus tick start", sub: "remember what was already dirty",
      body: "The session's own first verb, not the loop's: it records the set of files dirty before the tick touched anything. That set is subtracted at commit time, so a file someone else was editing is not this tick's to commit even if a later step edits it too. Run by hand in a terminal, with no loop around it to export the tick marker, it writes that marker itself.",
      writes: [".git/sweep-tick-start.json"],
    },
    {
      id: "run", kind: "step", x: 380, y: 560, actor: "claude", title: "Run /sweep", sub: "one headless session on the sweep model",
      body: "The loop hands the whole tick to a single headless Claude session running the /sweep skill. The skill is the orchestrator — there is no TypeScript function driving the eight steps; each is one argus or accio verb the session calls in order.",
      rule: "Runs with permissions skipped, inside the container, against the mounted data repo only.",
    },
    {
      id: "f-status", kind: "file", x: 780, y: 554, actor: "data", title: "The status surface",
      path: ".git/sweep-status.json · .git/sweep.log", sub: "running · lastRunAt · nextRunAt",
      body: "What Pensieve's top bar reads. Beside the lock in .git, so git never sees it. A container that died mid-tick has its stale running=true cleared at startup.",
    },

    {
      id: "pull", kind: "step", x: 1140, y: 0, actor: "argus", title: "2 · Pull", sub: "what landed, and what was said",
      body: "Reads each repo's base-branch landings, the deploy pipelines that tell whether a backend landing is live, and every Slack channel the projects name. Nothing new prints nothing new and the tick skips to the docs step — it still needs its commit to close out.",
      reads: ["Slack, each channel from its own cursor", "the product repos' base branches", "the pipelines, for whether a landing is live"],
      writes: ["state/batches/<id>.json", "state/cursor.next.json — not the cursor itself"],
      rule: "A channel that fails keeps its cursor while the others advance; a new channel is read from seven days back.",
    },
    {
      id: "src-slack", kind: "source", x: 1500, y: -6, actor: "data", title: "Slack, the repos, the pipelines",
      path: "read-only, every tick", sub: "per-channel cursors in state/cursor.json",
      body: "The landing watermark is derived rather than stored: the newest landing any ledger already holds, and landings a ledger already lists are dropped, so an overlapping window is harmless.",
    },
    {
      id: "place", kind: "step", x: 1140, y: 140, actor: "argus", title: "3 · Place", sub: "put each item on the feature that owns it",
      body: "A landing goes to every feature its files map to. Anything that cannot be placed goes to the unplaced list with the features active in that batch as candidates — a wrong placement misleads every later reader of that thread, so unplaced is a state, not a failure.",
      writes: ["state/batches/<id>.placed.json", "state/threads.json · state/unplaced.json", "the touched ledgers"],
      rule: "The same batch placed twice gives the same placed file, byte for byte.",
    },
    {
      id: "f-batch", kind: "file", x: 1500, y: 134, actor: "data", title: "The batch",
      path: "state/batches/<id>.json", sub: "named by its pull time",
      body: "A batch is processed against ledgers whose as_of is older, so a second run over the same batch changes nothing. This is what makes the whole tick safe to repeat.",
    },
    {
      id: "attribute", kind: "step", x: 1140, y: 280, actor: "claude", title: "4 · Attribute", sub: "only what a person could not place",
      body: "The verb prints the unplaced messages with the feature list, and the /sweep session answers it itself rather than delegating — then places each one it would bet on and leaves the rest. The batch is placed once more afterwards, so the slices carry what the threads just learned.",
      writes: ["state/threads.json — the only learned state, and it is committed"],
      rule: "Place only what you would bet on. Pensieve is where a person settles the rest.",
    },
    {
      id: "f-state", kind: "file", x: 1500, y: 274, actor: "data", title: "What was learned",
      path: "state/threads.json · state/unplaced.json", sub: "thread root → the feature it belongs to",
      body: "A thread mapped to null is nobody's, and stays that way. This is the only memory the sweep carries between ticks that is not derivable from the files themselves.",
    },
    {
      id: "read", kind: "step", x: 1140, y: 420, actor: "claude", title: "5 · Read", sub: "one subagent, one feature, one slice",
      body: "Each touched feature gets its own general-purpose subagent on opus, holding that ledger and only its slice of the batch. Two features in one context is how asks land on the wrong ledger. What it writes goes back through argus patch, validated whole — the model reads, the code stores.",
      writes: ["the feature's ledger.json, through argus patch"],
      rule: "A refused patch goes back to its reader once, then that feature is left for the next tick.",
    },
    {
      id: "f-ledger", kind: "file", x: 1500, y: 414, actor: "data", title: "The ledger",
      path: "<app>/features/<dir>/ledger.json", sub: "where the work actually stands",
      body: "Written only through argus patch, never by hand and never by the model directly. A write differing only in its as_of writes nothing at all.",
    },
    {
      id: "ground", kind: "step", x: 1140, y: 560, actor: "claude", title: "5 · Ground", sub: "the same step as Read, after it",
      body: "Still step 5. The reader cannot see product code, so it writes proposals without Technical Notes; one opus subagent per ungrounded proposal can, and fills them in — each note naming a repo path in backticks, or standing as an open question. Pins are taken fresh, because the shared checkouts go stale between pulls.",
      rule: "A refusal is handed back once; then the proposal waits for the next tick.",
    },
    {
      id: "reconcile", kind: "step", x: 1140, y: 700, actor: "argus", title: "6 · Reconcile", sub: "against the trackers, never writing to them",
      body: "Reads each key from the provider its prefix names and updates what the ledgers say about it. This is also where a filed revision settles: a parent marked Done folds its specs into the features and archives the revision; Canceled archives it without writing a spec.",
      reads: ["Linear and Trello, read-only", "revisions/<KEY>/revision.json"],
    },
    {
      id: "src-tickets", kind: "source", x: 1500, y: 554, actor: "linear", title: "The trackers",
      path: "Linear · Trello", sub: "read, never written",
      body: "The sweep never writes a ticket and never posts to Slack. Tickets are proposals on a ledger until a person files them.",
    },
    {
      id: "fold", kind: "step", x: 1140, y: 840, actor: "argus", title: "The fold", sub: "a revision becomes the live spec",
      body: "Every feature the revision names is resolved before anything is written; then each spec goes over that feature's docs/spec.md stamped with revised_by, a product.md beside it is removed as its replacement, and only then is the directory moved to the archive. A run that dies part-way leaves the revision filed, and the next run finishes the same fold.",
      writes: ["<app>/features/<dir>/docs/spec.md", "revisions/archive/<KEY>/"],
      rule: "Nothing here deletes: a revision leaves revisions/ only by moving, whole, into the archive.",
    },
    {
      id: "f-spec", kind: "file", x: 1500, y: 694, actor: "data", title: "The feature's spec",
      path: "<app>/features/<dir>/docs/spec.md", sub: "the new baseline the next /scope edits",
      body: "Once folded, this is what /scope reads as the baseline. The revision that produced it is in the archive, and its product.md is gone — the spec is its replacement.",
    },
    {
      id: "docs", kind: "step", x: 1140, y: 980, actor: "claude", title: "7 · Docs", sub: "refresh only what drifted",
      body: "A read-only staleness report names which features' arch docs have drifted from the code, and each one is refreshed against its pinned checkout. A repo the tick could not reach is skipped, so a doc is never refreshed against a stale tree.",
      reads: [".git/sweep-tick-unreachable.json", "each area's feature-manifest.json"],
      writes: ["<app>/features/<dir>/docs/arch.md"],
    },
    {
      id: "validate", kind: "step", x: 1140, y: 1120, actor: "argus", title: "8 · Validate and commit", sub: "the validator is the policy",
      body: "Everything the tick wrote is validated before any of it is committed. A feature that fails is left out of the commit and every other feature still commits — a bad ledger never blocks a good one.",
      rule: "A refusal prints the problems and exits non-zero; nothing is half-written.",
    },

    {
      id: "commit", kind: "step", x: 1900, y: 0, actor: "argus", title: "argus commit", sub: "one commit, exactly the paths declared",
      body: "The second half of step 8. It takes git's own view of what changed, keeps only what the allowlist permits — ledgers, arch and spec docs, anything under revisions/, three state files, the feature manifests, and a product.md only as a deletion — and subtracts whatever was already dirty when step 1 ran. It commits those named paths rather than the whole index, so something staged by hand does not ride along. projects.json is on no list.",
      rule: "At most one commit per tick, and nothing to commit means no commit.",
    },
    {
      id: "msg", kind: "step", x: 2260, y: 140, actor: "argus", title: "The message", sub: "sweep: <the first thing needing you>",
      body: "The first line needing your attention, else the first revision the reconcile moved, else \"quiet run\". The verb adds the sweep: prefix itself, so the skill never spells it out. The author is the sweep, not you.",
    },
    {
      id: "promote", kind: "step", x: 1900, y: 140, actor: "argus", title: "Promote the cursor", sub: "only after the commit succeeded",
      body: "Pull advanced the Slack cursors into a next file; only the commit verb renames it into place, and only once its own commit has succeeded or found nothing to commit. A crashed tick therefore replays every channel rather than losing what it read.",
      writes: ["state/cursor.json"],
    },
    {
      id: "endtick", kind: "step", x: 1900, y: 280, actor: "argus", title: "End the tick", sub: "record what is still owing",
      body: "What this tick finished still owing is written down, so the next tick can tell its own leftovers from a file somebody else is editing.",
    },
    {
      id: "push", kind: "step", x: 1900, y: 420, actor: "sweep", title: "Push the data repo", sub: "the loop, not the verb",
      body: "argus commit never pushes. The loop pushes after each tick, and only when a token is present — so a sweep with no credential still records everything locally.",
    },
    {
      id: "wait", kind: "step", x: 1900, y: 560, actor: "sweep", title: "Sleep until the next tick", sub: "release the lock",
      body: "The status file records when the last tick ended and when the next is due, which is what Pensieve's top bar shows while nothing is running.",
    },
  ],
  links: [
    { from: "svc", to: "lock" },
    { from: "lock", to: "sync" },
    { from: "src-projects", to: "sync", in: "l", dashed: true },
    { from: "sync", to: "run" },
    { from: "run", to: "f-status", out: "r", in: "l", dashed: true },
    { from: "run", to: "tickstart", out: "r", in: "l", tone: "claude" },
    { from: "tickstart", to: "pull" },

    { from: "src-slack", to: "pull", out: "l", in: "r", dashed: true },
    { from: "pull", to: "f-batch", out: "r", in: "l" },
    { from: "pull", to: "place" },
    { from: "f-batch", to: "place", out: "l", in: "r", dashed: true },
    { from: "place", to: "f-state", out: "r", in: "l" },
    { from: "place", to: "attribute" },
    { from: "attribute", to: "f-state", out: "r", in: "l", dashed: true },
    { from: "attribute", to: "read" },
    { from: "read", to: "f-ledger", out: "r", in: "l" },
    { from: "read", to: "ground" },
    { from: "ground", to: "f-ledger", out: "r", in: "l", dashed: true },
    { from: "ground", to: "reconcile" },
    { from: "src-tickets", to: "reconcile", out: "l", in: "r", dashed: true },
    { from: "reconcile", to: "f-ledger", out: "r", in: "r", dashed: true },
    { from: "reconcile", to: "fold" },
    { from: "fold", to: "f-spec", out: "r", in: "r" },
    { from: "fold", to: "docs" },
    { from: "docs", to: "validate" },
    { from: "validate", to: "commit", out: "r", in: "l", tone: "argus" },

    { from: "commit", to: "msg", out: "r", in: "t", dashed: true },
    { from: "commit", to: "promote" },
    { from: "promote", to: "endtick" },
    { from: "endtick", to: "push" },
    { from: "push", to: "wait" },
    { from: "wait", to: "svc", out: "l", in: "l", dashed: true, label: "SWEEP_INTERVAL" },
  ],
};
