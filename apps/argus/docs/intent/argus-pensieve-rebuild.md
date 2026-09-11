# Intent: rebuild Argus and Pensieve

Confirmed 2026-09-10 in an interview with the user.

- **Outcome:** A living page per feature that answers "how is this going?" the way a
  tech lead answers a founder: is it going well, do the two codebases agree, does the
  code satisfy the business rules, what is on me, is the architecture sound. Under it, a
  Needs-me list that closes itself when the evidence arrives, a ready-versus-blocked
  queue of the user's own tickets, and a chat with Argus that reads the same state and
  can propose changes to it.
- **User:** The user alone, as the alden-portal tech lead, part-time now and full-time
  soon. Nobody else reads it. Foundry consumes the tickets.
- **Why now:** Business rules are discovered after launch by assumption and corrected by
  complaint. Intent lives in Slack threads. The current build tracks events instead of
  rules, so it loses the story and never closes what the user already handled.
- **Success:** Open any feature cold and reply in its Slack thread within a minute. The
  Due-on-invoice case closes on the run after the team acknowledges it. A backend landing
  on `origin/dev` plus deploy flips the frontend ticket to ready without a click. Every
  rule shows assumed, confirmed, or contradicted, with who said so and when. Asking Argus
  "what did Foong ask for on invoicing this week" gets a cited answer from the page's own
  state.
- **Constraint:** Claude Code skills in this repo, model reads and code stores, docs
  update on their own, tickets and any change Ask suggests are proposed for a click,
  reminders live on the page only. Linear is the user's personal queue for Foundry,
  nothing more.
- **Out of scope:** Foundry changes. Posting to Slack or any push channel. Written briefs
  before launch. Multi-user Pensieve. Cloud deployment. Preserving the marauder, queue,
  decisions, and wave machinery.

## Facts that shaped it

- The business rule is the unit of the goal. Rules are found after launch, by
  assumption, and corrected by whoever complains. The requester does not review designs
  carefully, so assumptions are often wrong and stay wrong until someone notices.
- A ticket is ready when its scope is clear, it has no pending items, and no blockers.
  For frontend work that means the API is merged to `origin/dev` and deployed so the
  client can be generated. Backend and infra tickets will carry other blocker kinds.
- The current board fails on all four counts: noise and duplicates, wrong grain, no
  action attached, wrong facts. The worst case is a Needs-me item that the user already
  handled and the team acknowledged, kept open because no doc was written.
