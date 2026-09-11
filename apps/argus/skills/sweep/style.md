# style — how the loop writes for a reader

The voice for every page a person reads: `marauder/board.md`, each `marauder/changelog/<day>.md`,
what `marauder show <feature>` prints, and anything else the loop renders for a human. Stated
once, here. The renderer enforces the three mechanical rules at the bottom and refuses to
write a page that breaks one.

The pages are read rendered, in Pensieve, not in a terminal. Headings, bullets, tables,
blockquotes, bold, links, inline code and checkboxes render. A `<details>` toggle does
not, and a line indented straight under a bullet is joined onto it as one paragraph — so
a line meant to sit under a sentence needs a blank line above it, or its own bullet.

## Answer first

The first sentence says where the work stands. Not what happened, not what was scanned,
not how many things moved — where it stands, now, for someone who has to decide what to
do next. Everything after it is evidence for that sentence.

## A person does something in every sentence

Write "Sam landed the backend at 15:07", never "be#767 lands". Someone did the thing, and
naming them is what makes a line answerable — the reader knows who to ask. The reader is
"you"; everyone else is their first name after the first full mention. Nothing the loop
itself did belongs on a page: a reader does not care that a scan ran, only what it found.

## The work, named the way the team says it

"Rollover credits instead of a retainer top-up." "History editing." "The invoice email
rewrite." Not the feature folder, not the ticket title, not a route or a field name. If
the words would not survive being said out loud in the channel, they are the wrong words.

## Ids live on the evidence line

A ticket key, a PR number, a rule id, a sha and a thread link are evidence, not content.
They go on one muted line under the sentence they support, as links that say what they
are:

```markdown
**History editing**

Sam landed the backend this afternoon and your fix for the wrong credit weight is still
in review.

[Sam's message](permalink) · [the backend PR](url) · [ALD-2](url)
```

Never in a heading, never at the start of a line, never as the subject of a sentence.

## Sentences

Short, present tense, active, one thought each. Twenty-five words is the ceiling and most
should be well under it. At most one dash per sentence. Say the conclusion, not the
activity: "rollover applies at the invoice total", not "there was a discussion about
rollover".

## Structure

Bullets only for items that are genuinely parallel. Tables only for rows being compared
column by column — never for a list of things that happened. Headings only above roughly
five hundred words of body; below that they are furniture. No emoji, no italic stamp
lines, no summary block at the top that repeats the page, no checkboxes nobody can tick.

## Link, don't restate

The journal entry holds the why, the docs hold the rules, the ticket holds the scope, the
diff holds the code. A rendered page holds conclusions and links to the rest. A page that
retells any of them has stopped being a page worth reading.

## Backticks

Only for something that must be exact: a field, a route, a sha, a file, a frontmatter
value. Feature names, ticket keys, PR numbers and people are plain text.

## The three mechanical rules

The renderer applies these and fails loudly, naming the offending line:

1. **No line of reader text starts with an id** — not `ALD-2`, not `fe#417`, not `BR-` or
   `MM-` anything. Ids belong on the evidence line, and even there they are inside a link.
2. **None of these words appears in reader text**: tick, tier, arc, point, supersedes,
   corroborated, `BR-`, `MM-`. They are the system's own dialect, and a reader has to
   translate every one of them.
3. **No sentence runs past twenty-five words.**

The list in rule 2 lives next to the checker as a constant, so the checker and this file
cannot drift.
