# pensieve

The reading room for [argus](https://github.com/d0nwong/argus) — a UI over the
blackboard the sweep maintains, where the feature is the unit: the **board** (what needs
you, then each feature with something going on this week), a page per **feature** beside
its docs, the **Unsorted** queue behind them, the per-landing **change journal**, the
dual-tier **feature docs**, and the **archive** of what the loop wrote before 2026-09-09.

The front page is `marauder/board.md` as argus rendered it, with each feature's name linked
to `/features/<dir>` and every path in it pointed at the page that serves it. A feature's
page is `<app>/features/<dir>/board.md`, rendered beside the feature's `docs/` from the
`work.json` in the same directory, with the record's milestone, open questions, tickets
and PRs in the rail beside it.

Pensieve is read-only by design, with one exception. The sweep in argus owns every file it
shows; this app only parses and renders them, so there is never a second writer to the
workflow state. The exception is `decisions/`, which it writes in two shapes. **Unsorted**
lists what argus took in and could not attach to a feature, and lets you *attach* one to a
feature or *dismiss* it with a reason. A **feature page** lets you *verify* what an event
asked you to confirm, or *send* one of its tickets to
[Foundry](https://github.com/d0nwong/foundry). Either way it is one JSON file under
`decisions/` that argus reads back — and the click then runs argus's `marauder apply` on
it, so the record and the pages have changed before the page re-reads them; when that
run could not happen, the next `marauder ingest` applies the file. Nothing else is written
into the blackboard from here — not `work.json`, `queue/`, `marauder/`, the journal,
docs or tickets; those still go through argus, Linear or Slack.

**Ask** runs Claude Code over the checkout with a read-only tool set and keeps each
conversation as one file under `PENSIEVE_HOME` (default `~/.pensieve`) — outside the
blackboard, so the rule above holds. It can propose a correction, a send or a new ticket;
a click on the card is what writes.

## Stack

TanStack Start (React 19, Vite 8) on Bun · TanStack Router for file routes and typed
search params · `@tanstack/markdown` — parse once on the server, ship the AST, render in
React · Tailwind 4 with a docs-site look — Inter, white and grey, one blue, shadcn's Sidebar, light and dark.

The same shape as [foundry/web](https://github.com/d0nwong/foundry), on purpose: the
two could share a shell later.

## Setup

`./scripts/bootstrap.sh` takes a brand-new Mac to a running Pensieve. Same shape as
[Foundry's](https://github.com/d0nwong/foundry) and argus's: phases that run alone
(`prereqs`, `workspace`, `envfiles`, `home`, `deps`, `check`), `--check` to report
without changing anything, a prompt before every install, a no-op when a step is already
done. It installs bun and the `claude` CLI (`tailscale` optional), checks that the argus
checkout `WORKSPACE_DIR` names is a git repo with `reports/` and `skills/` — reporting
only; nothing here clones it or runs a git write command inside it — writes `.env` from
`.env.example`, creates `~/.pensieve/conversations/`, runs `bun install`, and finally
probes the two things that fail quietly: whether Foundry answers on `FOUNDRY_URL`, and
whether there is a Claude credential.

It never mints a secret, and never writes one either. `.env` carries two —
`FOUNDRY_API_TOKEN` and `LINEAR_API_KEY` — and the `envfiles` phase only says which of them
is missing and names the command that mints it: `cd ~/git/foundry && foundry auth --api`
for the token, Linear's own personal-API-key page for the key. Pasting them in is yours to
do, so no secret ever lands in `.env` without someone having looked at it. `claude login`
is likewise the CLI's own flow, which the script can only detect and point you at.

```sh
git clone <this repo> ~/git/pensieve && cd ~/git/pensieve
./scripts/bootstrap.sh            # everything, asking first
./scripts/bootstrap.sh --check    # what's missing, touching nothing
./scripts/bootstrap.sh check      # just: is Foundry up, is there a Claude credential?
```

## Running

After the Setup above (or `bun install` and `cp .env.example .env` by hand):

```sh
bun run dev                  # http://localhost:3778
bun test                     # the decisions writer, the Foundry client, Ask's store and run
bun run check                # lint + format check (Ultracite / Biome); `bun run fix` applies
ASK_LIVE=1 bun test src/server/ask.test.ts   # + two real claude turns over the checkout
```

Ask needs a credential: this machine's `claude login` (the default), or `ANTHROPIC_API_KEY`
in the environment, which wins when set. With neither, Ask reports itself off with the
reason. `PENSIEVE_HOME` is where its conversations go; nothing about Ask touches the
checkout — `git status` there is the same before and after a run.

Sending a ticket needs Foundry's trigger-API token: `foundry auth --api` in the Foundry repo
prints one, and `FOUNDRY_API_TOKEN` in this repo's `.env` is where Pensieve reads it from —
the environment and nowhere else, fresh on every request. `FOUNDRY_URL` defaults to
`http://localhost:3777`. With no token, Unsorted and Verify still work — Send is shown off, with the reason.

Filing a ticket from a proposal card needs `LINEAR_API_KEY` in the same `.env` — a personal
API key from linear.app (Settings → Security & access), which files into Linear as the key's owner. Without it a proposal is still checked against the last project list
Pensieve cached, and File is shown off with the reason.

Production, without a container:

```sh
bun run build                # dist/client + dist/server
bun run start                # bun server.ts — serves dist/client, hands the rest to Start
```

On the tailnet — HTTPS at this machine's MagicDNS name, no port-forwarding, tailnet-only
(never Funnel; the blackboard is private):

```sh
bun run serve                # build if needed, bun server.ts, `tailscale serve` → https://<host>.ts.net:3778/
bun run serve:dev            # same, but proxying the vite dev server (HMR included)
bun run unserve              # stop a running serve (and any orphaned proxy) — only this port's mapping
scripts/serve.sh status
```

Ctrl-C tears down both the app and the proxy. It listens on the app's port (not 443) so
it won't displace anything else the node serves; `TS_HTTPS_PORT=443` takes the root URL.
Needs MagicDNS + HTTPS certs enabled in
the tailnet admin; `vite.config.ts` already allows `.ts.net` hosts.

In a container — the blackboard is mounted, never copied in, because it changes every
sweep tick:

```sh
docker compose up --build    # mounts ~/git/argus at /workspace, read-only — except decisions/
WORKSPACE_DIR=/some/where FOUNDRY_API_TOKEN=… ANTHROPIC_API_KEY=… docker compose up
```

The blackboard is mounted read-only and `decisions/` is mounted writable over it, so the
container can write exactly the one directory it owns. Foundry runs on the host, so
`FOUNDRY_URL` defaults to `http://host.docker.internal:3777` there, and the container has
only its environment — pass `FOUNDRY_API_TOKEN` and `LINEAR_API_KEY` through it. Ask's
state is `/data` on the named volume `pensieve-home`, so conversations survive
`docker compose down && up`; there is no `claude login` inside the container, so pass
`ANTHROPIC_API_KEY`. The image carries `node`, `git` and the `claude` CLI for it.

## What it reads

| Route | Source in argus |
|---|---|
| `/` Board | `marauder/board.md` as the sweep rendered it: the milestone, **Needs you**, one section per feature with an event this week (its name linking to `/features/<dir>`), then **Waiting on others** by owner; the header carries the Unsorted count |
| `/features` | every `<app>/features/**/work.json` — each feature with something going on, by its manifest name, and when it last moved |
| `/features/<dir>` | one feature: `<app>/features/<dir>/board.md` as rendered beside its docs, the `work.json` beside it in the rail (milestone, open questions, tickets, PRs), the asks with **Verify** and the tickets with **Send** above, and Ask opening with `?feature=` |
| `/unsorted` | `queue/_unsorted.json` with `decisions/marauder/` laid over it — every entry newest first with its words, its source and the features it could have been, the select already on argus's suggestion; a decided row wears its verdict until argus applies it |
| `/journal` | every `<app>/features/**/journal/**/*.md` — frontmatter only, filterable by app / day / feature / status / text |
| `/journal/:feature/:slug` | one entry, frontmatter as marginalia |
| `/docs`, `/docs/:feature?tier=` | `<app>/features/**/docs/{product,arch}.md`, grouped by app, with `last_verified` ages |
| `/archive` (`/reports`, `/digests`, `/arcs`) | what the loop wrote before 2026-09-09 — a sweep report and a Slack digest per day, and the arcs — readable as history, written by nothing |

`<app>` is discovered, not configured: any directory one or two levels under
`WORKSPACE_DIR` holding a `features/` tree is an app — `foundry` and `pensieve` are one
deep, `alden/alden-portal` two. A feature is addressed as `<app>/<dir>`, and a bare
`<dir>` still resolves while it is unique across apps, so links written when the
workspace held one app keep working.

Two things the renderer does beyond CommonMark: `[[slug]]` wikilinks resolve to sibling
journal entries (`[[YYYY-MM-DD]]` to a day view), and HTML comments — the
`<!-- accio:begin … -->` fences in docs — are stripped.

## What it writes

Into the blackboard, only `decisions/`, in two groups, one file per click — from
Unsorted, from a feature page, or from the card an Ask proposes (below):

```json
{ "id": "1788949866.296519", "action": "attach", "feature": "admin/usage",
  "reason": "Sam's subtask rows are the usage history", "at": "2026-09-10T10:12:00.000Z", "by": "liam" }
```

`decisions/marauder/<id>.json` is a verdict on what the loop could not settle: `attach`
(with the `feature`, a directory under an app's `features/`), `dismiss` (with a
`reason`), or `verified` — the odd one, whose `id` names an *event* rather than a queue
entry: the user's go-ahead for the one edit a `directed-at-person` event asked about.
`id` is the entry's or the event's own name, folded into a file name since a Slack `ts`
is not a path segment; the id inside the file is the one that counts.
`decisions/send/<ticket>.json`, `{ ticket, action: "sent", job, at, by }`, is a ticket
handed to Foundry; nothing applies it, and the sweep's ticket pass reads it to keep off a
ticket Foundry is running.

Every file is written to a temp name in the same directory and renamed into place, so the
sweep never reads half of one, and it is never edited afterwards by either side. The pages
lay these files over what they read, so a row decided a minute ago wears its verdict
before argus has applied it.

The click applies it (ARG-169): once the file is renamed into place, `decideUnsorted` and
`verifyEvent` run `bun run marauder apply` in `WORKSPACE_DIR` (`src/server/marauder.ts`
`applyDecisions`, a `Bun.spawn` with a 30 s timeout and stderr captured) — argus's own
verb (ARG-168), which applies the decision files through the same correction functions
the command line goes through and renders the pages, under the lock every writing verb of
the sweep holds — and answer `{ ok, applied, note? }`. An applied Unsorted row is gone on
the re-read, and a verified event reads as confirmed. When the lock is busy, the run fails
or times out, or `bun` is not on the server's PATH, nothing throws: the file is still
written, the row wears its verdict with the note saying why, and the next `marauder
ingest` applies it and commits it untouched as the history of who decided what. This app
still writes only the decision file; the record changes through argus's code. Send is
unchanged, and Ask stays read-only.

*Verify* answers what a `directed-at-person` event asked — an inference the sweep drew and
is forbidden from acting on ("report first, edit after the user confirms"): a held edit on
a ticket Foundry is running, a fact that may have unsaid a Scope bullet. Verifying says the
reading is right; the next ingest stamps the event `confirmed`, and the ticket pass makes
exactly the edit the event named, once. The note is optional: the event's own text is the
instruction, so a confirmation needs no argument the way a dismissal does. Verify never
touches Foundry, so it works with `FOUNDRY_API_TOKEN` unset, as Dismiss does.

*Send* is one `POST /api/jobs` to Foundry with `{ ticketId, repo }` — no instructions;
Foundry composes the brief from the ticket and claims it in Linear — and an
`Idempotency-Key` equal to the ticket key, so a double click or a retry after a timeout
answers the job the first call made and writes the file once. A Foundry error (`400`,
`401`, `409`, `503`, or unreachable) is shown with its message and writes nothing; a `409`
names the job already holding the ticket. Send is offered on a feature page beside a ticket nobody has started — Linear's Backlog
or Todo — with no `decisions/send/<ticket>.json` yet; filing one is the sweep's job, or
Ask's proposal card. After a send the page polls
`GET /api/jobs/:id` every few seconds while the job is queued or running, then shows its
final status and PR.

The repo is picked, not typed. The loader reads `GET /api/repos` server-side — the token
never leaves the server, so the list travels with the page — and the form is a select
over what Foundry answered for that page load, opened on the repo the page suggests for that
ticket when that names one of them (by name or by path) and on nothing when it does not, since a repo
Foundry does not track is a `400` waiting to happen. Nothing re-validates the choice: it
came from Foundry, and `POST /api/jobs` stays the authority. A Foundry that cannot answer
with a list at all — unreachable, or old enough to have no such route — costs the page
nothing but the picker: the field is the free-text box it was before, and a repo typed into
it sends exactly as it always did.

## Ask

`askChat` runs one turn of Claude Code (`@tanstack/ai-claude-code`, the `sonnet` alias)
with the checkout as its working directory, under `permissionMode: 'default'` with a
read-only allowlist (`src/lib/ask-tools.ts`): `Read`, `Grep`, `Glob`, `Skill`, `git log` /
`git show` (bare, and `git -C <checkout> …` for the FE and BE checkouts — `FE_REPO` /
`BE_REPO`, both as `~/…` and as the absolute path, since a `Bash(...)` rule is a literal
command prefix), `bun run accio …` (its `sync` and `map` verbs denied), and the hosted
Linear server's read tools (`mcp__linear__get_issue`, `list_issues`, `list_comments`, …);
every Linear write tool is denied by name. Two tools are bridged into the run from Pensieve itself, `propose_decision` and
`propose_ticket`, allowed as `mcp__tanstack__…` (below). It sees
argus's skills (`ask`, `sweep`, `linear-ticket`, …) because argus links them into its own `.claude/skills`, and its
`.mcp.json` because `settingSources` is `['project']`. A system prompt is appended to
Claude Code's own (`ASK_SYSTEM_PROMPT`): the session is told it is a web panel with no
terminal and no permission dialog, to load the `ask` skill and retrieve with `marauder show <feature>` /
`marauder board` / `marauder changelog`, to cite every path, and that it cannot write, edit a
ticket or run the sweep — so a denied tool is reported in one sentence, never relayed as a
request for approval — and that a correction, a send or a ticket is proposed, never performed. The
answer streams back as SSE over a Start server function, so
`useChat({ fetcher })` reads it directly.

Every run persists through `withPersistence` from `@tanstack/ai-persistence`, over a store
that keeps one conversation per file:

```
$PENSIEVE_HOME/conversations/<threadId>.json
{ "threadId", "messages": [ …model messages… ], "metadata": { "sessionId", "feature"? }, "createdAt", "updatedAt" }
```

The user turn is written when the run starts, the partial answer while it streams, and the
whole transcript before `RUN_FINISHED` goes out — so a reload at any moment shows what
there is. `metadata.sessionId` is the Claude session the run reported; the next question
on the same thread is sent with `--resume <id>`, read on the server, so the client never
carries it. Files are written to a temp name in the same directory and renamed into
place. The client sends the full transcript each turn (what `useChat` holds), or `[]` to
continue the stored one as it stands; a delta would replace the stored thread. Two sends
on one thread are serialised on the server as well as in the client.

`listConversations` (newest first, titled by the first user turn), `getConversation`,
`deleteConversation` (removes that one file) and `askStatus` (is a credential available?)
are the other server functions.

How a run ended is on disk too. A run that ends in error writes `metadata.lastError`
(message, code, time) — cleared when the next run starts — and a run that stopped at the
turn cap writes `metadata.finishReason: "length"` together with its whole transcript (the
persistence middleware saves the final transcript only on a clean finish; Ask saves it
itself on that path, so the file holds every tool part, not the streaming snapshot). When
the error is about the credential, the message on screen and in the file ends with a
diagnosis line: which `claude` binary the run spawned (`command -v claude` from Pensieve's
environment), the auth mode, and what `claude auth status` said (`askStatus` returns the
same as `claudePath` and `probe`; the footer shows `host login · claude.ai`). On macOS the
first credential read after a `claude` update can raise a Keychain dialog that a headless
subprocess cannot answer — choose Always Allow. `ASK_DEBUG=1` prints TanStack AI's full
trace for every run; without it, the CLI's non-JSON output lines are printed only when a
run ends in error.

The pages: `/ask` lists the conversations and mints a thread id for a new one; `/ask/<id>`
is `createChatHook` from `@tanstack/ai-react/ui` (`src/features/ask/`) mapped onto the
chat blocks, hydrated from `getConversation` in the route loader. The answer streams in
as it is written, each `Read` / `Grep` / `Glob` call is a collapsed Tool block naming its
path or pattern, and a second question sent while the first is answered waits in a queue.
Stop — and a reload mid-answer, which drops the request the same way — ends the run and
keeps the partial answer; the next question resumes the same Claude session. With no
credential the composer is disabled and says what to do. Delete asks once and removes the
file. Every feature page has an Ask action that opens a conversation on that feature, with a
breadcrumb back to it; the question starts with `/ask`, which loads argus's `ask` skill
explicitly (a `/skill` prefix expands under `claude -p`), so the first tool call is
`marauder show <feature>`.

A conversation opened from a feature carries it: the URL adds `feature=<dir>` beside
`q`, the first run stores it as `metadata.feature`, the session gets a second system
prompt naming it — so "it" means that feature and its story is read first — and the page
shows the feature as a line above the transcript, linking back to its page. A
conversation with no feature shows nothing there.

The model can propose a verdict too. `propose_decision` (`src/server/ask-tools.server.ts`)
is a TanStack bridged tool, and a bridged tool always executes when the model calls it —
the harness has no approval gate — so it only checks and never writes: an attach names a
feature that exists and an entry still in the queue, a dismiss carries a reason, a send
names a ticket and a configured Foundry (the same checks and the same error strings
`decideUnsorted` and `sendTicket` run before they write). It answers a proposal or
`{ ok: false, error }`. The chat renders the proposal as a card (`decision-card.tsx`): the
verdict, the feature, the reason as an editable field, the repo for a send — the same
picker over Foundry's tracked repos — and Confirm, which calls `decideUnsorted` /
`sendTicket`, so the file is what the page would have written for the same input.
`propose_ticket` is the same shape for a drafted Linear issue: the card shows the draft
and File creates it (`fileTicket`, once per proposal). The model is told to say a verdict
is proposed and never that it is done; once a decision file exists the card shows the
decided line and offers no second Confirm, on reload as well.
Every other page refreshes when dragged down from
the top (touch or mouse): the route loaders re-run, nothing else moves.

## Layout

```
src/server/workspace.ts   the reader — every blackboard file, as typed shapes (and finds the apps)
src/server/decisions.ts   the one writer — atomic decision files under decisions/, nowhere else
src/server/foundry.ts     the Foundry client — POST /api/jobs, GET /api/jobs/:id, GET /api/repos, the token
src/server/ask.ts         Ask — the Claude Code adapter config, the per-file conversation store, the run
src/test/                 bun test preload: vitest shim for the persistence conformance suite
src/lib/api.ts            server functions — the client/server bridge
src/lib/ask-tools.ts      Ask's tool names — the allow / deny lists and what the page renders as a Tool block
src/server/marauder.ts    the board, the features' work.json, the queue and the milestones, with links pointed at routes
src/features/work/        a feature page's actions — Send and Verify — and the controls the proposal card reuses
src/features/unsorted/    the Unsorted queue — attach and dismiss, one click each
src/features/ask/         Ask's chat as a feature slice — model/ (state, the bound createChatHook), components/ (widgets), lib/ (helpers); routes import its index only
src/routes/               file routes (routeTree.gen.ts is generated by `tsr`)
src/components/           shell, markdown renderer, small shared bits
server.ts                 production entry (Bun.serve → dist)
scripts/bootstrap.sh      brand-new Mac → running Pensieve, in phases; --check reports without touching anything
scripts/serve.sh          build + run + `tailscale serve`, torn down together
```
