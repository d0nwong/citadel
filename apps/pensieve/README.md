# pensieve

The reading room for [argus](https://github.com/d0nwong/argus) — a UI over
the blackboard the sweep maintains: **sweep reports** (the Needs-you queue), **Slack
digests**, the per-landing **change journal**, and the dual-tier **feature docs**.

Pensieve is read-only by design, with one exception. The sweep in argus owns every
file it shows; this app only parses and renders them, so there is never a second writer to
the workflow state. The exception is `decisions/`: the **Points** page lists the sweep's
Needs-you points and lets you *ignore* one with a reason or *send* one to
[Foundry](https://github.com/d0nwong/foundry), and each verdict is one JSON file there
that the sweep reads back and commits. Nothing else is written into the blackboard from
here — not the journal, docs, reports or tickets; those still go through Linear, Slack,
or the argus skills.

**Ask** runs Claude Code over the checkout with a read-only tool set and keeps each
conversation as one file under `PENSIEVE_HOME` (default `~/.pensieve`) — outside the
blackboard, so the rule above holds. The server half landed in LIA-102, the pages in LIA-103.

## Stack

TanStack Start (React 19, Vite 8) on Bun · TanStack Router for file routes and typed
search params · `@tanstack/markdown` — parse once on the server, ship the AST, render in
React · Tailwind 4 with a paper-and-ink palette.

The same shape as [foundry/web](https://github.com/d0nwong/foundry), on purpose: the
two could share a shell later.

## Running

```sh
bun install
cp .env.example .env         # WORKSPACE_DIR defaults to ~/git/argus
bun run dev                  # http://localhost:3778
bun test                     # the decisions writer, the Foundry client, Ask's store and run
ASK_LIVE=1 bun test src/server/ask.test.ts   # + two real claude turns over the checkout
```

Ask needs a credential: this machine's `claude login` (the default), or `ANTHROPIC_API_KEY`
in the environment, which wins when set. With neither, Ask reports itself off with the
reason. `PENSIEVE_HOME` is where its conversations go; nothing about Ask touches the
checkout — `git status` there is the same before and after a run.

Sending a point needs Foundry's trigger-API token. `foundry auth --api` writes
`FOUNDRY_API_TOKEN` to the shared credentials file `~/.config/liamai/env` (override the
path with `LIAMAI_ENV`), which Pensieve reads fresh on every request; setting the variable
in the environment or `.env` wins over the file. `FOUNDRY_URL` defaults to
`http://localhost:3777`. With no token, the Points page still lets you ignore a point —
Send is shown off, with the reason.

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
`FOUNDRY_URL` defaults to `http://host.docker.internal:3777` there; the shared credentials
file is not mounted, so pass `FOUNDRY_API_TOKEN` in the environment. Ask's state is
`/data` on the named volume `pensieve-home`, so conversations survive
`docker compose down && up`; there is no `claude login` inside the container, so pass
`ANTHROPIC_API_KEY`. The image carries `node`, `git` and the `claude` CLI for it.

## What it reads

| Route | Source in argus |
|---|---|
| `/` Inbox | `reports/<latest>.md` + `digests/<latest>.md`, and the count of open points |
| `/points` | `reports/points.json` — Needs-you as data, grouped Decide / Verify / Confirm / On hold / Housekeeping, with `decisions/` laid over it |
| `/reports`, `/reports/:day` | `reports/YYYY-MM-DD.md` — one per day, overwritten each tick |
| `/digests`, `/digests/:day` | `digests/YYYY-MM-DD.md` |
| `/journal` | every `<app>/features/**/journal/**/*.md` — frontmatter only, filterable by app / day / feature / status / text |
| `/journal/:feature/:slug` | one entry, frontmatter as marginalia |
| `/docs`, `/docs/:feature?tier=` | `<app>/features/**/docs/{product,arch}.md`, grouped by app, with `last_verified` ages |

`<app>` is discovered, not configured: any directory one or two levels under
`WORKSPACE_DIR` holding a `features/` tree is an app — `foundry` and `pensieve` are one
deep, `alden/alden-portal` two. A feature is addressed as `<app>/<dir>`, and a bare
`<dir>` still resolves while it is unique across apps, so links written when the
workspace held one app keep working.

Two things the renderer does beyond CommonMark: `[[slug]]` wikilinks resolve to sibling
journal entries (`[[YYYY-MM-DD]]` to a day view), and HTML comments — the
`<!-- accio:begin … -->` fences in docs — are stripped.

## What it writes

Into the blackboard, only `decisions/<group>/<slug>.json`, one per point acted on from
`/points`:

```json
{ "point": "decide/lia-86", "action": "sent", "at": "2026-09-05T10:12:00.000Z",
  "subject": "LIA-86", "job": { "id": "…", "url": "http://localhost:3777/" } }
```

`action` is `"ignored"` (with a `reason`) or `"sent"` (with the Foundry `job`). The file is
written to a temp name in the same directory and renamed into place, so the sweep never
reads half of one, and it is never edited afterwards by either side. The page merges these
files with `points.json` itself rather than trusting the sweep's `decision` field alone, so
a point decided a minute ago shows as decided before the next tick re-emits the file.

*Send* is one `POST /api/jobs` to Foundry with `{ ticketId, repo }` — no instructions;
Foundry composes the brief from the ticket and claims it in Linear — and an
`Idempotency-Key` equal to the point id, so a double click or a retry after a timeout
answers the job the first call made and writes the file once. A Foundry error (`400`,
`401`, `409`, `503`, or unreachable) is shown with its message and writes nothing; a `409`
names the job already holding the ticket. Send is offered only on a point with a
`ticket`; filing one is the sweep's job, not this page's. After a send the page polls
`GET /api/jobs/:id` every few seconds while the job is queued or running, then shows its
final status and PR.

## Ask

`askChat` runs one turn of Claude Code (`@tanstack/ai-claude-code`, the `sonnet` alias)
with the checkout as its working directory and exactly these tools: `Read`, `Grep`,
`Glob`, `Bash(git log:*)`, `Bash(git show:*)`, under `permissionMode: 'default'` — nothing
that writes or runs. It sees argus's skills (`sweep`, `slack-digest`, `log-change`, …)
because argus links them into its own `.claude/skills`. The answer streams back as SSE
over a Start server function, so `useChat({ fetcher })` reads it directly.

Every run persists through `withPersistence` from `@tanstack/ai-persistence`, over a store
that keeps one conversation per file:

```
$PENSIEVE_HOME/conversations/<threadId>.json
{ "threadId", "messages": [ …model messages… ], "metadata": { "sessionId" }, "createdAt", "updatedAt" }
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

The pages: `/ask` lists the conversations and mints a thread id for a new one; `/ask/<id>`
is `createChatHook` from `@tanstack/ai-react/ui` (`src/chat/ask-ui.tsx`) mapped onto the
chat blocks, hydrated from `getConversation` in the route loader. The answer streams in
as it is written, each `Read` / `Grep` / `Glob` call is a collapsed Tool block naming its
path or pattern, and a second question sent while the first is answered waits in a queue.
Stop — and a reload mid-answer, which drops the request the same way — ends the run and
keeps the partial answer; the next question resumes the same Claude session. With no
credential the composer is disabled and says what to do. Delete asks once and removes the
file. Every point on `/points` has an Ask action that opens a conversation already asking
about that point, with a breadcrumb back to the points.

## Layout

```
src/server/workspace.ts   the reader — every blackboard file, as typed shapes (and finds the apps)
src/server/decisions.ts   the one writer — atomic decision files under decisions/, nowhere else
src/server/foundry.ts     the Foundry client — POST /api/jobs, GET /api/jobs/:id, the token
src/server/ask.ts         Ask — the Claude Code adapter config, the per-file conversation store, the run
src/test/                 bun test preload: vitest shim for the persistence conformance suite
src/lib/api.ts            server functions — the client/server bridge
src/chat/ask-ui.tsx       Ask's chat, bound once: createChatHook over the blocks, askChat as transport
src/routes/               file routes (routeTree.gen.ts is generated by `tsr`)
src/components/           shell, markdown renderer, small shared bits
server.ts                 production entry (Bun.serve → dist)
```
