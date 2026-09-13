/**
 * /scope, end to end: a ramble through the interview, intent, specs and plan to a filed
 * revision, then each sub-issue through Foundry and the sweep's fold into the feature's
 * live docs/spec.md. Two phases sit side by side: on the left what happens with the user in
 * the /scope conversation, on the right what runs after filing.
 */

import type { Flow } from "../model.ts";

export const scope: Flow = {
  id: "scope",
  name: "/scope",
  title: "From a ramble to a live spec",
  lede: "Your notes become a filed revision, its sub-issues run through Foundry, and the sweep folds its specs in as the new baseline once the parent is Done.",
  source: "apps/argus/skills/scope/",
  labels: { claude: "/scope skill" },
  first: "specs",
  // columns: phase one at 10 / 380 / 780, phase two at 1140 / 1500 / 1860
  items: [
    { id: "ph-a", kind: "phase", x: 10, y: -70, actor: "you", title: "With you", sub: "the /scope skill, in one conversation" },
    { id: "rule", kind: "rule", x: 1080, y: -70, actor: "data", title: "" },
    { id: "ph-b", kind: "phase", x: 1140, y: 600, actor: "data", title: "After filing", sub: "runs without you, except merging" },

    {
      id: "in", kind: "step", x: 380, y: 0, actor: "you", title: "Your ramble", sub: "/scope <ramble | KEY | path>",
      body: "A few sentences, a ticket of notes, or a notes file. Add --parent <KEY> to file under an issue that already exists.",
      rule: "Interactive only: never in a loop, CI or the sweep.",
    },
    {
      id: "src-data", kind: "source", x: 10, y: 96, actor: "data", title: "What exists",
      path: "<app>/features/<dir>/docs/spec.md · arch.md", sub: "the baseline, the standing research, and an Alden feature’s ledger",
      body: "The feature’s live spec, if it has one, is the baseline the revision edits. The arch doc is standing research: only the parts this work touches are drawn into the spec and plan.",
      reads: ["accio find \"<words>\" for an Alden screen or field", "feature-manifest.json aliases for Foundry, Pensieve and Argus", "argus show <dir> for a ledger"],
    },
    {
      id: "src-linear", kind: "source", x: 10, y: 206, actor: "linear", title: "The ticket",
      path: "Linear issue", sub: "when the argument is a ticket key",
      body: "A key argument is read with get_issue: its notes, its parent and its blockers.",
      reads: ["mcp__linear__get_issue"],
    },
    {
      id: "ground", kind: "step", x: 380, y: 120, actor: "claude", title: "1 · Ground", sub: "Find the features and read what exists, before the first question",
      body: "The skill names every feature the work touches as an <app>/<dir> key, such as foundry/jobs or pensieve/board, and reads each one’s baseline before forming a hypothesis.",
      reads: ["docs/spec.md and docs/arch.md per feature", "the ledger, for Alden features", "the Linear issue, for a key"],
      rule: "Every argus and accio call carries ARGUS_ROOT.",
    },
    {
      id: "interview", kind: "step", x: 380, y: 250, actor: "claude", title: "Interview", sub: "One question at a time, each with a guess",
      body: "A hypothesis with a confidence number, then one question with the skill’s guess attached. It stops when it can predict your answer to the next three questions, then restates: Outcome, User, Why now, Success, Constraints, Out of scope.",
      reads: ["interview.md (from addy agent-skills)"],
      rule: "“Sounds good” and “whatever you think” are not a yes.",
    },
    {
      id: "g1", kind: "gate", x: 410, y: 385, actor: "you", title: "Your yes", sub: "on the restate",
      body: "An explicit yes on the restated intent. A correction is folded in and the restate comes back.",
    },
    {
      id: "intent", kind: "step", x: 380, y: 480, actor: "argus", title: "2 · Intent", sub: "argus revision new <slug> --feature <app>/<dir>",
      body: "The verb creates the draft record and the skill writes the confirmed restate beside it. The slug names the work in two or three words.",
      writes: ["revisions/<slug>/revision.json (draft, by the verb only)", "revisions/<slug>/intent.md"],
    },
    {
      id: "f-intent", kind: "file", x: 780, y: 474, actor: "data", title: "The draft revision",
      path: "revisions/<slug>/", sub: "revision.json · draft\nintent.md",
      body: "Lives in citadel-data, not under the feature, so dropping the work never leaves a stale file behind. revision.json is written by argus verbs only.",
    },
    {
      id: "specs", kind: "step", x: 380, y: 615, actor: "claude", title: "3 · Specs", sub: "Copy each baseline, edit the copy",
      body: "One file per feature: the whole spec as it will read once the work is live, not a delta. A feature with no baseline gets its first spec from the arch doc, product.md, the ledger and the interview.",
      reads: ["<app>/features/<dir>/docs/spec.md", "spec.md (from addy agent-skills)"],
      writes: ["revisions/<slug>/specs/<app>/<dir>.md"],
      rule: "Criteria are checks: an S-n id, an outcome and never a mechanism. New ids start at next_id; a removed criterion moves to ## Retired and its id is never reused.",
    },
    {
      id: "f-specs", kind: "file", x: 780, y: 612, actor: "data", title: "A revised feature spec",
      path: "specs/<app>/<dir>.md", sub: "front matter: feature · revised_by · next_id",
      body: "Objective, Criteria, Out of scope, Assumptions and Retired, under 250 curated lines. No commands or code style: those are the repo’s.",
    },
    {
      id: "doubt", kind: "step", x: 10, y: 735, actor: "claude", title: "Doubt pass", sub: "A fresh subagent sees only the artifact and its contract",
      body: "An adversarial review of each spec against the intent, and of the plan against the specs. Every finding is reconciled: fix the artifact, fix the contract, keep a trade-off and tell you, or note it as noise.",
      reads: ["the artifact", "its contract: the intent, or the specs"],
      rule: "Stops when a round finds only trivia, or after three rounds.",
    },
    {
      id: "g2", kind: "gate", x: 410, y: 755, actor: "you", title: "Your yes", sub: "on each spec",
      body: "Each spec is shown with its new, reworded and retired ids called out, and with what the doubt pass changed.",
    },
    {
      id: "plan", kind: "step", x: 380, y: 855, actor: "claude", title: "4 · Plan", sub: "The difference, cut into tickets",
      body: "A numbered ticket list with the criteria each covers and what blocks it, then one body per ticket whose acceptance criteria each cite (spec S-n).",
      reads: ["the revised specs", "plan.md (from addy agent-skills)", "the code, verified at a sha"],
      writes: ["revisions/<slug>/plan.md"],
    },
    {
      id: "f-plan", kind: "file", x: 780, y: 858, actor: "data", title: "The plan",
      path: "plan.md", sub: "tickets · risks · one body per ticket",
      body: "Each “## n. title” section is filed verbatim as that ticket’s description, so the plan is the record of what was filed.",
    },
    {
      id: "g3", kind: "gate", x: 410, y: 995, actor: "you", title: "Your yes", sub: "on the tickets",
      body: "The ticket list and every body, after the doubt pass. Nothing touches Linear before this.",
    },
    {
      id: "file", kind: "step", x: 380, y: 1090, actor: "linear", title: "5 · File", sub: "Parent and sub-issues, then argus revision file",
      body: "The parent is created, or with --parent rewritten whole and never patched. Sub-issues are saved in plan order with their blockers. Then the verb files the record, the folder takes the key’s name, and the revised_by lines swap the slug for the key.",
      reads: ["plan.md"],
      writes: ["the Linear parent and its sub-issues", "revisions/<KEY>/revision.json (filed)"],
      rule: "A failed save stops the step and leaves the draft for a retry.",
    },
    {
      id: "f-filed", kind: "file", x: 780, y: 1090, actor: "data", title: "The filed revision",
      path: "revisions/<KEY>/", sub: "status filed · tickets in plan order",
      body: "The folder is now named after the parent key. Foundry’s host reads its specs, and the tickets cite its ids.",
    },

    {
      id: "job", kind: "step", x: 1500, y: 680, actor: "foundry", title: "Foundry job", sub: "One sub-issue, one PR",
      body: "The host looks up the ticket’s parent, finds its filed revision, and hands the job its context in this order: linked issues, then each feature’s revised spec, then its arch doc, then the files the ticket names. The cap is 64 KB and nothing is truncated; what doesn’t fit is listed by name.",
      reads: ["revisions/<KEY>/specs/*", "<app>/features/<dir>/docs/arch.md"],
      writes: ["a branch and a PR"],
      rule: "The job never edits the spec. forge-spec cites the S-n ids it builds to.",
    },
    {
      id: "drop", kind: "step", x: 1140, y: 1210, actor: "argus", title: "Dropped", sub: "argus revision drop --reason, or the parent Canceled",
      body: "The revision moves whole to the archive as dropped. No spec is touched and nothing is deleted.",
      writes: ["revisions/archive/<KEY>/ (dropped)"],
    },
    {
      id: "merge", kind: "step", x: 1500, y: 815, actor: "you", title: "You merge the PR", sub: "The sub-issue closes on merge",
      body: "Review is your other gate. A PR whose branch or title carries the key closes that sub-issue in Linear when it merges.",
    },
    {
      id: "done", kind: "step", x: 1500, y: 950, actor: "linear", title: "Parent marked Done", sub: "Once every sub-issue has landed",
      body: "The fold waits on the parent, not the sub-issues, so the baseline only changes once the whole change is live.",
    },
    {
      id: "fold", kind: "step", x: 1500, y: 1085, actor: "sweep", title: "Reconcile fold", sub: "The next sweep tick",
      body: "For each feature, the revised spec is written over its docs/spec.md and a product.md beside it is deleted. Then the revision is archived as done and the sweep commits.",
      reads: ["revisions/<KEY>/specs/*"],
      writes: ["<app>/features/<dir>/docs/spec.md", "revisions/archive/<KEY>/ (done)"],
      rule: "Drafts are ignored: only a filed revision on a Done parent folds.",
    },
    {
      id: "f-arch", kind: "file", x: 1490, y: 1225, actor: "data", title: "The archived revision",
      path: "revisions/archive/<KEY>/", sub: "status done · kept whole",
      body: "The intent, specs and plan stay together as the record of why the feature reads as it does.",
    },
    {
      id: "f-live", kind: "file", x: 1860, y: 1080, actor: "data", title: "The live spec",
      path: "<app>/features/<dir>/docs/spec.md", sub: "the live baseline · product.md retired",
      body: "Written only by a fold. The next revision to touch this feature starts by copying it.",
    },
  ],
  links: [
    { from: "in", to: "ground" },
    { from: "src-data", to: "ground", label: "reads", out: "r", in: "l", dashed: true },
    { from: "src-linear", to: "ground", out: "r", in: "l", dashed: true },
    { from: "ground", to: "interview" },
    { from: "interview", to: "g1" },
    { from: "g1", to: "interview", label: "not yet", out: "l", in: "l", dashed: true },
    { from: "g1", to: "intent", label: "yes" },
    { from: "intent", to: "f-intent", label: "writes", out: "r", in: "l" },
    { from: "intent", to: "specs" },
    { from: "specs", to: "f-specs", label: "writes", out: "r", in: "l" },
    { from: "specs", to: "doubt", label: "each spec", out: "l", in: "t", dashed: true },
    { from: "plan", to: "doubt", label: "the plan", out: "l", in: "b", dashed: true },
    { from: "specs", to: "g2" },
    { from: "g2", to: "specs", label: "fix", out: "r", in: "r", dashed: true },
    { from: "g2", to: "plan", label: "yes" },
    { from: "plan", to: "f-plan", label: "writes", out: "r", in: "l" },
    { from: "plan", to: "g3" },
    { from: "g3", to: "plan", label: "fix", out: "r", in: "r", dashed: true },
    { from: "g3", to: "file", label: "yes" },
    { from: "file", to: "f-filed", label: "revision file", out: "r", in: "l" },
    { from: "f-filed", to: "job", label: "each sub-issue, with its spec + arch", out: "r", in: "l" },
    { from: "f-filed", to: "drop", label: "abandoned", out: "b", in: "l", dashed: true },
    { from: "job", to: "merge", label: "PR" },
    { from: "merge", to: "job", label: "next sub-issue", out: "l", in: "l", dashed: true },
    { from: "merge", to: "done", label: "last one" },
    { from: "done", to: "fold" },
    { from: "fold", to: "f-live", label: "writes", out: "r", in: "l" },
    { from: "fold", to: "f-arch", label: "archives" },
    { from: "f-live", to: "f-specs", label: "the next revision copies it", out: "t", in: "r", dashed: true, tone: "sweep" },
  ],
};
