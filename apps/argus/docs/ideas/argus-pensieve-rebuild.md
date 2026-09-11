# Argus and Pensieve, rebuilt around the ledger

Refined 2026-09-10 with the user. Intent: `docs/intent/argus-pensieve-rebuild.md`.
Spec: `SPEC.md`.

## Problem Statement
How might we give a part-time tech lead a trustworthy, always-current answer to "how is
this feature going, and what is on me?" when the rules are discovered after launch and
the intent lives in Slack?

## Recommended Direction
Each feature keeps one record: a ledger of requirements, each assumed, confirmed, or
contradicted with who said so and when, and a ledger of asks, each moving from asked to
closed with the evidence that moved it. Tickets are the actionable children of asks and
carry typed blockers. Every run, code fetches what is new from Slack and both repos,
joins the deterministic parts (files to features, replies to threads), and the model
rewrites each affected feature's record whole. Code validates, diffs, and commits.

Pensieve renders the founder's five questions per feature from that record, a Needs-me
list of asks pointing at the user, a ready list of tickets with no blockers left and a
Send button, an unplaced list that one click resolves, and a chat with Argus over the
same record. The arch tier survives as the capped technical spec; the product tier
becomes the ledger itself.

`accio` stays, trimmed to the code-and-docs index (`find`, the manifest, one arch
staleness check, schema validation). `marauder` is retired; `slack-pull.ts` and
`pr-facts.ts` move under the new run command.

## Key Assumptions to Validate
- [ ] Attribution from manifest plus summaries hits four in five on a two-week replay of
      the channel, measured against the attachments the user corrected by hand.
- [ ] The largest feature's record plus a busy day's batch fits one affordable model call.
- [ ] The closure judgement closes the Due-on-invoice thread on the acknowledgement
      message, and two other threads the user remembers.
- [ ] A BR table converts to a requirement ledger by dropping the mechanism column, one
      feature by hand (usage or invoicing).

## MVP Scope
In: one app (alden-portal), one channel, the record schema, the run skill, attribution
with the unplaced list, the requirement and ask ledgers, ticket blockers of the frontend
kind, the five-question feature page, Needs-me, Ready with Send, Ask over the record,
evidence on every claim.

## Not Doing (and Why)
- Events, keys, vocab, the attachment ladder, decision files, the apply verb and its
  lock. The model's rewrite replaces the join, and a click writes the record directly
  through one validated command.
- The journal as files. Its content becomes the ask ledger's history.
- The product tier as prose. The ledger is the product doc; a short workflows list stays.
- Notifications off the page. The user opens Pensieve all day.
- Foundry changes. It receives a ticket key and a repo, as today.
- Backend and infra blocker types. The shape allows them; the first build ships the
  frontend kind.
- Cloud deployment. Shared disk first.

## Open Questions
- Does Send go straight to Foundry or through a proposal card? Spec'd as a direct send
  with a confirm.
- Initial requirement statuses: seed everything as assumed, bulk-confirm per feature once.
- Which `product.md` sections, if any, the user still reaches for and wants kept as prose.
