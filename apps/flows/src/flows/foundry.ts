/**
 * A Foundry job, end to end: what the host does before a container exists, what the forge
 * does inside it, and what the host does afterwards with the credentials the container
 * never sees. Three phases left to right, because the split between them is the design.
 */

import type { Flow } from "../model.ts";

export const foundry: Flow = {
  id: "foundry",
  name: "Foundry",
  title: "A ticket becomes a pull request",
  lede: "The host clones the repo, packs the context the ticket already names, and launches a disposable container. The forge edits and writes its own PR description; the host pushes, opens the PR and then watches it.",
  source: "apps/foundry/web/src/features/jobs/server/ · apps/foundry/image/forge-run.sh",
  labels: { claude: "the forge", foundry: "Foundry host" },
  first: "context",
  // columns: host at 10 / 380 / 780, container at 1140 / 1500, after at 1900 / 2260
  items: [
    { id: "ph-host", kind: "phase", x: 10, y: -80, actor: "foundry", title: "On the host", sub: "every credential lives here, and only here" },
    { id: "rule-1", kind: "rule", x: 1080, y: -80, actor: "data", title: "" },
    { id: "ph-forge", kind: "phase", x: 1140, y: -80, actor: "claude", title: "In the container", sub: "one session across every step; no credentials at all" },
    { id: "rule-2", kind: "rule", x: 1840, y: -80, actor: "data", title: "" },
    { id: "ph-after", kind: "phase", x: 1900, y: -80, actor: "foundry", title: "Back on the host", sub: "push, PR, and the watcher" },

    {
      id: "send", kind: "step", x: 380, y: 0, actor: "pensieve", title: "Send", sub: "a ticket, a repo, and nothing else",
      body: "Pensieve's Send beside a ticket, the ignite dialog in Foundry's own UI, or a plain POST. Since CTD-284 nobody sends blueprintId unless a person picked one: omitting the key is what lets Foundry choose.",
      writes: ["POST /api/jobs { repo, ticketId }"],
      rule: "Only a ticket in Backlog or Todo can be sent.",
    },
    {
      id: "api", kind: "step", x: 380, y: 140, actor: "foundry", title: "POST /api/jobs", sub: "authorize, parse, resolve the repo",
      body: "The bearer token is checked, the payload parsed, and the repo resolved against the curated set — by exact path, by ~-expanded path, or by basename when exactly one tracked repo has it. An untracked repo or a bad blueprint is a 400 before any tracker round trip.",
      reads: ["the tracked repos on the Repos page"],
    },
    {
      id: "idem", kind: "step", x: 780, y: 140, actor: "foundry", title: "Idempotency-Key", sub: "fingerprinted over the raw body bytes",
      body: "The same key with the same body replays the original job as a 200 and queues nothing. The same key with a different body is a 422. Because the fingerprint is taken over the bytes, adding or dropping a key — as CTD-284 did with blueprintId — makes an old point re-send as a new job rather than replay.",
    },
    {
      id: "bp", kind: "step", x: 380, y: 280, actor: "foundry", title: "Choose the blueprint", sub: "from what the job is, not who sent it",
      body: "A job carrying a ticketId and naming no blueprint runs the seeded spec-driven recipe; a job with instructions and no ticket runs Plan → Execute. An explicit blueprintId wins over both, and \"none\" is itself an explicit choice — one bare step, no recipe. (CTD-283)",
      rule: "The blueprint is snapshotted onto the row at insert, so editing it later never changes a job already queued.",
    },
    {
      id: "row", kind: "file", x: 780, y: 274, actor: "data", title: "The job row",
      path: "Postgres · foundry.jobs", sub: "repo · baseBranch · blueprint snapshot · ticketId",
      body: "Only the orchestrator process touches Postgres. The base branch is the one sent, else the last used for that repo, else the repo's default.",
    },
    {
      id: "clone", kind: "step", x: 380, y: 420, actor: "foundry", title: "Clone at the base", sub: "a per-job clone, never a worktree",
      body: "git clone --branch <base> into ~/.foundry/jobs/<id>. A local clone hardlinks its objects, so it is cheap; a worktree's .git is a pointer into the real checkout, which would mean mounting your working repo into the sandbox. The host also brands the branch before the container starts.",
      writes: ["~/.foundry/jobs/<id>/ — the workspace the container gets"],
    },
    {
      id: "src-linear", kind: "source", x: 10, y: 414, actor: "linear", title: "Linked tickets",
      path: "the tracker, as it reads now", sub: "every key the task names, up to ten",
      body: "Each ticket the task links is fetched from whichever provider its key names and carried whole, up to ten — past that a key is listed as not fetched rather than dropped. They fill before anything else, so a heavily cross-referenced ticket can crowd out its own code.",
    },
    {
      id: "context", kind: "step", x: 380, y: 560, actor: "foundry", title: "Pack the context", sub: "resolve what the ticket already names",
      body: "hydrateTask appends a ## Context section: the linked tickets, the reviewed spec of the revision the ticket belongs to, the source files it names in backticks, then the arch docs. Line references are stripped from a path before it is resolved, in every form a ticket writes them. Nothing path-shaped is dropped in silence — what did not resolve is listed as missing, and what did not fit is listed as cut.",
      reads: ["the ticket's own backticked paths, at the base commit", "the revision's spec, narrowed to the features those paths belong to", "each app's .doc-workspace/feature-manifest.json"],
      rule: "64 KB cap. Filled tickets → spec → files → arch docs, so a big file never cuts the spec.",
    },
    {
      id: "src-data", kind: "source", x: 10, y: 554, actor: "data", title: "citadel-data",
      path: "revisions/<KEY>/specs/ · features/<dir>/docs/", sub: "the reviewed spec and the arch doc",
      body: "Read on the host and pasted into the task. The container never sees citadel-data itself — it gets the text, not the directory.",
    },
    {
      id: "pack", kind: "file", x: 780, y: 554, actor: "data", title: "The task, hydrated",
      path: "## Context", sub: "### KEY · ### Spec: · ### `path` · ### Not included",
      body: "The task above it is verbatim. Where a line number in the task disagrees with a file carried here, the file is current — it was read at the base commit.",
    },
    {
      id: "guard", kind: "step", x: 380, y: 700, actor: "foundry", title: "Check the image has the skills", sub: "refuse rather than half-run",
      body: "A blueprint whose steps invoke /forge-* skills the image does not carry is refused before the container starts, naming the missing skill and telling you to run foundry build. Skills are COPY'd into the image, so a skill edit needs a rebuild.",
    },

    {
      id: "launch", kind: "step", x: 1140, y: 0, actor: "foundry", title: "Launch the forge", sub: "OrbStack · foundry/forge:latest",
      body: "The container is handed the workspace, a Claude credential, a per-job callback token and — when one is configured — a gateway token. Nothing else of the host's .env reaches it: no gh, no bb, no Linear or Trello key, no citadel-data. It touches a tracker only by proxy through the MCP gateway, and reports progress back to /api/jobs/<id>/events.",
      rule: "At most FOUNDRY_MAX_JOBS run at once; the agent is killed at FOUNDRY_TIMEOUT.",
    },
    {
      id: "skills", kind: "source", x: 1500, y: -6, actor: "foundry", title: "The skills",
      path: "/opt/foundry/skills", sub: "forge-spec · forge-plan · forge-test · forge-implement · forge-verify · …",
      body: "Baked into the image, so they ship with foundry build and never with a migration. forge-run.sh and the PR template are bind-mounted instead, so editing those needs no rebuild.",
    },
    {
      id: "steps", kind: "step", x: 1140, y: 140, actor: "claude", title: "Run the steps", sub: "one session, resumed across all of them",
      body: "The blueprint's steps run in order, each with its own model and effort. The first opens the session; every later one resumes it, so the step that implements already holds what the step that planned read. A step whose prompt is a /forge-* invocation is running a skill; the older recipes still carry inline prose instead.",
      reads: ["FOUNDRY_STEPS — the snapshotted blueprint"],
      rule: "Headless: it may never ask a question, and it cannot push.",
    },
    {
      id: "finish", kind: "step", x: 1140, y: 280, actor: "claude", title: "Finish", sub: "edits in /work, and the PR description",
      body: "The agent leaves completed edits behind and writes the PR description itself, following the repo's template or foundry's own. A task naming a ticket gets a Closes <KEY> line, which is what links the PR back and closes the issue on merge.",
      writes: [".git/PR_BODY.md — under .git/ so it can never be committed"],
    },
    {
      id: "prbody", kind: "file", x: 1500, y: 274, actor: "data", title: "The PR description",
      path: ".git/PR_BODY.md", sub: "summary · assumptions · how it was verified",
      body: "Written by the agent, used verbatim by the host. Its first commit's subject line becomes the PR title.",
    },
    {
      id: "sweepc", kind: "step", x: 1140, y: 420, actor: "claude", title: "Sweep up the edits", sub: "commit whatever was left uncommitted",
      body: "The agent may commit as it goes or just leave edits in the tree, so a final pass commits the rest. The outcome is judged by whether HEAD moved, not by the sweep alone — a job that changed nothing is not a job that succeeded.",
    },

    {
      id: "push", kind: "step", x: 1900, y: 0, actor: "foundry", title: "Push and open the PR", sub: "with your credentials, on the host",
      body: "The container is gone by now. The host pushes the branch and opens the pull request through gh or bb, whichever the origin wants, using the description the agent wrote.",
      rule: "This is the whole point of the split: the forge never holds a credential.",
    },
    {
      id: "link", kind: "step", x: 1900, y: 140, actor: "linear", title: "Link it to the ticket", sub: "Closes <KEY>",
      body: "The host links the PR back to the issue. On a GitHub origin the tracker reads the same line itself, and the key in the branch and title is what actually closes it on merge.",
    },
    {
      id: "settle", kind: "step", x: 1900, y: 280, actor: "foundry", title: "Settle the row", sub: "succeeded · failed · pr_ready",
      body: "A root job whose PR opened waits in pr_ready rather than settling: its PR is still open and the watcher still reads the row. Purging a pr_ready job is what ends that.",
    },
    {
      id: "watch", kind: "step", x: 1900, y: 420, actor: "foundry", title: "Watch the PR", sub: "polling, not a webhook",
      body: "The Mac has no public endpoint, so the host polls the PRs of the last fortnight's jobs once a minute with its own credentials. Watermarks in pr_watches mean the same review, conflict or commit is never acted on twice, even with two server processes running.",
    },
    {
      id: "followup", kind: "step", x: 1900, y: 560, actor: "foundry", title: "Queue a follow-up", sub: "a review, a conflict, a red check",
      body: "A submitted review becomes a job with the comments as its task. A conflict with the base becomes a forge-merge job. A red check becomes a forge-debug job — but not on the first failure: on GitHub the host reruns the failed CI jobs once, because a rerun costs CI minutes and a forge costs a session, and only a second failure on the same commit queues anything.",
      rule: "Bounded by FOUNDRY_PR_RETRIES, so a red check cannot launch forever.",
    },
  ],
  links: [
    { from: "send", to: "api" },
    { from: "api", to: "idem", out: "r", in: "l", dashed: true, label: "replay or refuse" },
    { from: "api", to: "bp" },
    { from: "bp", to: "row", out: "r", in: "l" },
    { from: "row", to: "clone", out: "b", in: "r", dashed: true },
    { from: "bp", to: "clone" },
    { from: "src-linear", to: "context", out: "b", in: "l", dashed: true },
    { from: "src-data", to: "context", in: "l", dashed: true },
    { from: "clone", to: "context" },
    { from: "context", to: "pack", out: "r", in: "l" },
    { from: "context", to: "guard" },
    { from: "guard", to: "launch", out: "r", in: "l", tone: "foundry" },
    { from: "skills", to: "launch", out: "l", in: "r", dashed: true, label: "baked in" },
    { from: "launch", to: "steps" },
    { from: "steps", to: "finish" },
    { from: "finish", to: "prbody", out: "r", in: "l" },
    { from: "finish", to: "sweepc" },
    { from: "sweepc", to: "push", out: "r", in: "l", tone: "foundry" },
    { from: "prbody", to: "push", out: "r", in: "l", dashed: true },
    { from: "push", to: "link" },
    { from: "link", to: "settle" },
    { from: "settle", to: "watch" },
    { from: "watch", to: "followup" },
    { from: "followup", to: "api", out: "l", in: "b", dashed: true, label: "queues another job" },
  ],
};
