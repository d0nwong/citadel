# pensieve

The reading room for [argus](https://github.com/d0nwong/citadel-data) — a UI over the
ledgers the sweep maintains, where the feature is the unit: the **home** page (what is on
you, what is ready to work on, what nothing could place), a page per **feature** over its
`ledger.json`, the dual-tier **feature docs**, the **sweep** log, and **Ask**.

The front page is three lists over every feature's `ledger.json` — the asks aimed at you
that are not done, the tickets of yours with nothing left to wait for, and the messages the
last runs could not place on a feature — and one line per feature under them. A feature's
page is that feature's `ledger.json` read out in the order a founder asks: the story, the
asks with what happened to each, the tickets with their blockers, the proposals, the
requirements with who confirmed them, the landings.

Pensieve does not edit a ledger itself. Every write runs one argus verb: `src/server/argus.ts`
spawns `bun scripts/argus.ts <verb> … --json` from `ARGUS_DIR` with `ARGUS_ROOT` pointed at
`WORKSPACE_DIR`, and reads the JSON the verb prints. A click therefore goes through the same
validator and the same correction functions the command line goes through, and a refusal
comes back as data (`ok: false` with its problems), never as a crash. Two writes leave the
app instead of landing in the workspace: a ticket, on Linear for a Citadel draft and on the
Alden Trello board for an alden-portal one (`@citadel/tickets`' `createTicket`), and a job
handed to [Foundry](https://github.com/d0nwong/foundry).

**Ask** runs Claude Code over the argus checkout and keeps each conversation as one file
under `PENSIEVE_HOME` (default `~/.pensieve`). It can propose a correction or a new ticket;
a click on the card is what writes, through the same server function the pages call.

## Stack

TanStack Start (React 19, Vite 8) on Bun · TanStack Router for file routes and typed
search params · `@tanstack/markdown` — parse once on the server, ship the AST, render in
React · Tailwind 4 with a docs-site look — Inter, white and grey, one blue, shadcn's Sidebar, light and dark.

The same shape as [foundry/web](https://github.com/d0nwong/foundry), on purpose: the
two could share a shell later.

## Setup

`just bootstrap`, from citadel's root, takes a brand-new Mac to a running Pensieve, and
`just check` reports what is missing while changing nothing. Phases run alone (`prereqs`,
`identity`, `deps`, `env`, `trust`, `data`, `home`, `links`, `forge`), every install is
prompted, and a step already done is a no-op. It installs bun and the `claude` CLI
(`tailscale` optional), writes the one `.env` every app shares, creates
`~/.pensieve/conversations/`, installs the workspace's dependencies, and reports the rest:
argus's data directory, the product checkouts, and whether Claude trusts `apps/argus` — which
Ask needs before its Slack tools work on a host.

Pensieve reads its secrets from that `.env`: `FOUNDRY_API_TOKEN`, which bootstrap mints and
`just auth foundry-api --rotate` replaces, `LINEAR_API_KEY`, which you paste in with
`just auth linear`, and `TRELLO_API_KEY` / `TRELLO_TOKEN` for the Alden board. None is ever
echoed, and the file stays mode 600.

```sh
git clone https://github.com/d0nwong/citadel ~/git/citadel && cd ~/git/citadel
just bootstrap                    # everything, asking first
just check                        # what's missing, touching nothing
```

## Running

After the Setup above (or `bun install` and `cp .env.example .env` by hand):

```sh
bun run dev                  # http://localhost:3778
bun test                     # the argus runner, the ledger reader, the Foundry and Linear clients, the ticket checks, the worktrees, Ask's store and run
bun run check                # lint + format check (Ultracite / Biome); `bun run fix` applies
ASK_LIVE=1 bun test src/server/ask.test.ts   # + two real claude turns over the checkout
```

Ask needs a credential: this machine's `claude login` (the default), or `ANTHROPIC_API_KEY`
in the environment, which wins when set. With neither, Ask reports itself off with the
reason. `PENSIEVE_HOME` is where its conversations and its local-mode worktrees go.

Sending a ticket needs Foundry's trigger-API token: `foundry auth --api` in the Foundry repo
prints one, and `FOUNDRY_API_TOKEN` in citadel's one `.env` is where Pensieve reads it from —
the environment and nowhere else, fresh on every request. `FOUNDRY_URL` defaults to
`http://localhost:3777`. With no token every other click still works — Send is shown off, with the reason.

Filing a ticket needs a credential for the provider its team routes to: `LINEAR_API_KEY` for
a Citadel draft, `TRELLO_API_KEY` and `TRELLO_TOKEN` for an alden-portal one. Their home is
citadel's one `.env`, which also feeds the MCP gateway: `bun run dev` and `bun run start` go
through `scripts/root-env.sh`, which copies in only the keys Pensieve reads — never the Slack
or gateway token, which an Ask run would otherwise inherit. `LINEAR_API_KEY` is a personal
API key from linear.app (Settings → Security & access), which files into Linear as the key's
owner. Without it a proposal is still checked against the last project list Pensieve cached,
and File is shown off with the reason.

Production, without a container:

```sh
bun run build                # dist/client + dist/server
bun run start                # bun server.ts — serves dist/client, hands the rest to Start
```

On the tailnet — HTTPS at this machine's MagicDNS name, no port-forwarding, tailnet-only
(never Funnel; the record is private):

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

In the stack — argus's data is mounted, never copied in, because it changes every sweep tick:

```sh
just up pensieve             # http://localhost:3778 (PENSIEVE_PORT moves it)
```

The data directory (`ARGUS_DATA_DIR`, `~/git/citadel-data` by default) is mounted read-write at
`/argus-data`, and the container runs argus's verbs against it from `/app/apps/argus`
(`ARGUS_DIR`). The product checkouts are mounted read-only, for Ask's history reads. The
container gets only the keys Pensieve reads; the gateway token arrives as a secret file,
because Claude Code runs a headersHelper without secret-looking variables. Ask's
conversations live on a volume, with Claude's own transcripts beside them, so a resumed
conversation survives a restart.

Foundry runs on the host, so `FOUNDRY_URL` defaults to `http://host.docker.internal:3777`
there, and the container has only its environment — pass `FOUNDRY_API_TOKEN`,
`LINEAR_API_KEY` and the Trello pair through it. Ask's state is `/data` on the named volume
`pensieve-home`, so conversations survive `docker compose down && up`; there is no
`claude login` inside the container, so pass `ANTHROPIC_API_KEY`. The image carries `node`,
`git` and the `claude` CLI for it, and sets `PENSIEVE_RUNNER=container`.

## What it reads

| Route | Source in argus |
|---|---|
| `/` Home | every `<app>/features/**/ledger.json` and `state/unplaced.json`, as three lists — **On you** (the open asks aimed at you, with Done, Ignore, Move and Ticket), **Ready to work on** (the tickets with no blocker left, with Send, fetched after the shell has painted because it needs live Linear and Trello state), **Unplaced** (with Place and Nothing) — and one line per feature under them |
| `/features` | the same ledgers, one line each: the open count, how many are on you, how many are ready, and the feature's health |
| `/features/<app>/<dir>` | one feature's `ledger.json`: the story, the asks with their history, the tickets with their blockers, the proposals with File, the requirements with Confirm and Contradict, the landings; plus links to its arch doc and to Ask opened on it |
| `/docs` | every `<app>/features/**/docs/{product,arch}.md`, grouped by app, filterable by app, with the `last_verified` ages for each repo |
| `/docs/<app>/<dir>?tier=` | one doc, product or arch, with the frontmatter in the rail and an outline |
| `/ask` | every conversation under `PENSIEVE_HOME/conversations/`, newest first, titled by its first question |
| `/ask/<id>` | one conversation, hydrated from its file; `?feature=<dir>` opens it on a feature and `?q=` sends a question straight away |
| `/sweep` | `.git/sweep-status.json` and the tail of `.git/sweep.log` in the data repo — the running (or last) tick's stream-json, read back as the model's text, its tool calls, a tool's failure and the closing result; polled while the tick runs |

The sidebar carries the unplaced count on Home, and the top bar carries the sweep's status.

`<app>` is discovered, not configured: any directory one or two levels under
`WORKSPACE_DIR` holding a `features/` tree is an app — `foundry` and `pensieve` are one
deep, `alden/alden-portal` two. A feature is addressed as `<app>/<dir>`, and a bare
`<dir>` still resolves while it is unique across apps, so links written when the
workspace held one app keep working.

Two things the renderer does beyond CommonMark: HTML comments — the
`<!-- accio:begin … -->` fences in docs — are stripped, and a `[[slug]]` wikilink renders as
its own text, since the journal it used to point at is gone.

## What it writes

Every change to the record is one argus verb, run through `src/server/argus.ts` with a 30 s
timeout, and every page on screen re-reads its loaders when it lands.

| Click | Verb |
|---|---|
| Done, on an ask | `argus close <dir> <A-n> --reason` |
| Ignore, on an ask | `argus drop <dir> <A-n> --reason` |
| Move, on an ask | `argus move <dir> <A-n> <to>` |
| Confirm / Contradict, on a requirement | `argus confirm <dir> <R-n> --reason [--contradict]` |
| Confirm all | `argus confirm <dir> --all --reason` |
| Place, on an unplaced message | `argus place <id> <dir>` |
| Nothing, on an unplaced message | `argus dismiss <id>` |
| Ticket, on an ask or a proposal | `argus file <dir> <id>` for the draft, then `argus ticket <dir> <id> <key>` once the provider has made it |
| Send, on a ready ticket | `argus sent <dir> <ticket> --repo <repo> --job <id>` once Foundry has taken it |

A reason is required where the table names one, and refused before argus is even spawned.
Argus's own refusal — its validator's problems, a verb that will not start, a run that times
out — is shown as the sentence it gave, and nothing changes.

*Ticket* asks argus for the draft covering the ask or proposal (it refuses when there is
none), files it through `@citadel/tickets`' `createTicket` — the Alden board's Pipeline list
with the feature's own label — and then puts the key back on the ledger. A ticket that is
filed but that the ledger refuses says so rather than pretending either half did not happen.

*Send* is one `POST /api/jobs` to Foundry with `{ ticketId, repo }` — no instructions;
Foundry composes the brief from the ticket and claims it — and an `Idempotency-Key` equal to
the ticket key, so a double click or a retry after a timeout answers the job the first call
made. A Trello card is refused when its list is neither Pipeline nor High Priority Pipeline,
the board's own answer for "nobody has started it"; a board that cannot answer lets the send
through. A Foundry error (`400`, `401`, `409`, `503`, or unreachable) is shown with its
message and records nothing; a `409` names the job already holding the ticket. After a send
the row polls `GET /api/jobs/:id` every few seconds while the job is queued or running, then
shows its final status and PR. A ticket on no ledger still sends — the row says the send was
not recorded, rather than calling `argus sent` with an empty feature.

The repo is picked, not typed. The loader reads `GET /api/repos` server-side — the token
never leaves the server, so the list travels with the page — and the form is a select over
what Foundry answered for that page load, since a repo Foundry does not track is a `400`
waiting to happen. Nothing re-validates the choice: it came from Foundry, and
`POST /api/jobs` stays the authority. A Foundry that cannot answer with a list at all —
unreachable, or old enough to have no such route — costs the page nothing but the picker.

## Ask

`askChat` runs one turn of Claude Code (`@tanstack/ai-claude-code`, the `opus` alias) with
argus's code as its working directory and the data (`WORKSPACE_DIR`) as an extra directory,
which the `argus` and `accio` verbs find through `ARGUS_ROOT`.

`PENSIEVE_RUNNER` picks the mode per request. **Container** mode — the image's own — runs
under `permissionMode: 'default'` with a read-only allowlist (`src/lib/ask-tools.ts`):
`Read`, `Grep`, `Glob`, `Skill`, `WebFetch`, `WebSearch`, `git log` / `git show` (bare, and
`git -C <path> …` for the FE and BE checkouts and the workspace — `FE_REPO` / `BE_REPO`, both
as `~/…` and as the absolute path, since a `Bash(...)` rule is a literal command prefix),
`accio` (its `sync` and `map` verbs denied), `argus show` and `argus validate`,
`argus tracker show` and `argus tracker list` — the read verbs named one at a time, because a
bare `argus` rule would carry the write verbs with it — and the hosted Slack server's read
tools. Every Slack and Linear write tool is denied by name, as are the harness's own write
tools and `argus tracker create` / `edit`. **Local** mode — the host's default — runs as the
operator's own Claude Code with `bypassPermissions`, their `~/.claude` and their MCP servers,
but never against the live checkouts: a conversation's first question cuts `citadel` and
`citadel-data` worktrees on branch `ask/<id>` under `PENSIEVE_HOME/worktrees/<id>/`
(`src/server/worktrees.ts`), and every run in that conversation works there. Each later
question rebases the citadel-data branch onto main, so a ledger the sweep committed since is
what the run reads; a conflict is left in the worktree for the run itself to resolve. A
local conversation gets a **Commit to main** button, which commits the worktree, rebases,
fast-forwards the live checkout's main and removes both worktrees and both branches.

Two tools are bridged into the run from Pensieve itself, `propose_decision` and
`propose_ticket`, allowed as `mcp__tanstack__…` (below). The session sees argus's skills
(`ask`, `sweep`, `linear-ticket`, `scope`, …) because argus links them into its own
`.claude/skills`, and its `.mcp.json` because `settingSources` includes `'project'`. A
conversation whose first turn starts `/scope` runs on a wider config: Ask's reads plus
`Edit` and `Write` under the data's `revisions/`, the `argus revision` verbs and
`argus tracker create` / `edit`, with the skill's own "wait for the user's yes" as the gate.

A system prompt is appended to Claude Code's own (`ASK_SYSTEM_PROMPT` in `src/server/ask.ts`;
`LOCAL_ASK_SYSTEM_PROMPT` for local mode). It names the working directory and the data
directory, says to load the `ask` skill and follow it, and gives the retrieval recipes: a
feature's record is `argus show <feature>`, what nobody could place is
`<workspace>/state/unplaced.json`, the record's history is `git -C <workspace> log`, where a
screen or field lives in the code is `accio find "<words>"`, a ticket is
`argus tracker show <KEY>`, a Slack permalink is `mcp__slack__slack_read_thread`, and code
from a product checkout is `git -C <repo> show origin/<branch>:<path>` at the sha the ledger
names — never `git fetch`, `pull`, `checkout` or `stash`. It then says to cite every path and
command, that "the files don't say" beats a guess, and that a change to the record goes
through `propose_decision` and a new ticket through `propose_ticket`, each confirmed by the
user on a card, so the session never says a thing is done. The container prompt adds that
this is not a terminal — there is no permission dialog and no one to answer one, so a denied
tool is an answer and never a request for approval; the local prompt drops that and adds
that a commit, a push or a PR happens only on the user's word. The answer streams back as
SSE over a Start server function, so `useChat({ fetcher })` reads it directly, with a
`: ping` comment every 15 s (`src/server/keepalive.ts`) so a proxy with an idle limit does
not cut a quiet stretch.

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
`deleteConversation` (removes that one file), `getConversationDiscard` (what a delete or a
Finish would throw away in the worktrees), `finishConversation` and `askStatus` (is a
credential available?) are the other server functions.

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
file. Every feature page has an Ask action that opens a conversation on that feature.

A conversation opened from a feature carries it in the URL (`?feature=<dir>`), and the
page shows the feature as a line above the transcript, linking back to its page. The server
is ready to keep it — `askChat` accepts `feature`, would store it as `metadata.feature`
and add a second system prompt naming it, so "it" means that feature — but the fetcher in
`src/features/ask/model/chat-options.ts` still forwards the retired `point` and `arc`
keys and not `feature`, so today the feature never reaches the run and the line lasts
only while the parameter is in the URL. A conversation with no feature shows nothing there.

The model can propose a change to the record. `propose_decision`
(`src/server/ask-tools.server.ts`) is a TanStack bridged tool, and a bridged tool always
executes when the model calls it — the harness has no approval gate — so it only checks and
never writes: one of the four verbs a person actually does (`close` and `confirm` /
`contradict` on a feature's own ids, `place` on an entry still in `state/unplaced.json`),
each naming a feature-shaped directory, all but `place` carrying a reason under 280
characters. It answers a proposal or `{ ok: false, error }`. The chat renders the proposal as
a card (`decision-card.tsx`): the verdict, the feature, the reason as an editable field, and
Confirm — which calls `closeAsk` / `confirmRequirement` / `placeUnplaced`, the very server
functions the pages call, so the verb argus runs is the same either way. `propose_ticket` is
the same shape for a drafted ticket: the card shows the draft, its team and project, an
assignee picker for an Alden board draft, and File creates it (`fileTicket`, once per
proposal — the record under the thread's `ticket:<toolCallId>` key is what a reload reads,
never the replayed tool part). The model is told to say a draft is ready and never that it is
filed. Every page refreshes when dragged down from the top (touch or mouse): the route
loaders re-run, nothing else moves.

## Layout

```
src/server/workspace.ts       the reader — the apps, the arch docs, the markdown, as typed shapes
src/server/ledger.ts          every feature's ledger.json and state/unplaced.json, and the home lists
src/server/argus.ts           the one writer — `bun scripts/argus.ts <verb> … --json`, its JSON read back
src/server/ticket.ts          the team table (Alden → Trello, Citadel → Linear) and a draft's checks
src/server/linear.ts          Linear's reads — the team's projects, cached under PENSIEVE_HOME
src/server/foundry.ts         the Foundry client — POST /api/jobs, GET /api/jobs/:id, GET /api/repos, the token
src/server/ask.ts             Ask — the adapter config, the per-file conversation store, the run
src/server/ask-tools.server.ts  the bridged tools — propose_decision and propose_ticket, read-only
src/server/worktrees.ts       local mode's git — the per-conversation worktrees, the rebase, Finish
src/server/sweep.ts           the sweep loop's status file and tick log, from the data repo's .git
src/server/sections.ts        slicing a parsed document by its headings — the title drop and the outline
src/server/keepalive.ts       a `: ping` every 15 s so a proxy does not cut a quiet stream
src/lib/api.ts                server functions — the client/server bridge
src/lib/ledger.ts             the ledger's shapes on both sides of the wire, and the derived lists
src/lib/ask-tools.ts          Ask's tool names — the allow / deny lists and what the page renders as a Tool block
src/lib/send.ts               what both sides need to know about handing a ticket to Foundry
src/lib/sweep-log.ts          a tick's stream-json as text, tool calls, failures and the closing result
src/features/ledger/          the home page's lists and a feature page's sections, with their clicks
src/features/work/            the bits both share — the repo field, the one commit, the refusal, the job line
src/features/ask/             Ask's chat as a feature slice — model/ (state, the bound createChatHook), components/ (widgets), lib/ (helpers); routes import its index only
src/routes/                   file routes (routeTree.gen.ts is generated by `tsr`)
src/components/               shell, markdown renderer, small shared bits
src/test/                     bun test preload: vitest shim for the persistence conformance suite
server.ts                     production entry (Bun.serve → dist)
scripts/root-env.sh           runs a command with only the keys Pensieve reads, from citadel's .env
scripts/serve.sh              build + run + `tailscale serve`, torn down together
```
