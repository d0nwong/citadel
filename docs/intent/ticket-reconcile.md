# Intent: reconcile settles tickets from Linear and from landings

Confirmed 2026-09-13.

## Outcome

`argus reconcile` finishes open tickets from two sources: a live landing carrying the
ticket's key, and the ticket's state in Linear. Done settles the ticket and closes every
ask it serves; Canceled drops them. Evidence is the PR or the ticket key.

## User

The repo owner, reading a feature page and the On-you list in Pensieve, and the sweep
running unattended.

## Why now

On 2026-09-12 tickets were finished in other Claude Code sessions and through Foundry, with
their PRs merged. The next morning's sweep still showed them ready: reconcile only ever
finished a ticket through its asks, so a ticket filed from a gap (no ask) could never
finish, and Pensieve's state tag hid a finished ticket behind "sent". The ledger and
reality disagreed.

## Success

After one sweep, ALD-45 and ALD-47 on `admin/usage` show done with no hand edit, and any
ticket moved to Done or Canceled in Linear settles on the next tick.

## Constraints

- Linear is read-only from argus, never written. One GraphQL query per team per run, for
  the tickets still open across every ledger.
- The credential is `LINEAR_API_KEY`, the key Pensieve already files with, handed to the
  sweep container beside `SLACK_TOKEN`. Code-side reads (Slack pull, Bitbucket pipelines,
  now Linear) use direct keys; the MCP gateway serves the model's sessions. Without the key,
  tickets settle only from landings, as a landing waits when Bitbucket cannot be asked.
- A settled ticket's asks are settled with it; the validator refuses a settled ticket that
  still serves an open ask.

## Out of scope

Reading Linear for anything else, filing or updating issues, changing how asks close from
Slack, and Pensieve reading Linear live on page load.
