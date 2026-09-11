# attribute — say which feature an unplaced message belongs to

## Overview

Code placed everything it could prove: replies in known threads, messages naming a
ticket or a PR, landings by their files. What is left is here. For each message, name the
one feature it is about, or say it is about none. You are given the feature list with
each feature's summary and open asks. A wrong placement misleads every later reader of
that thread, so place only what you would bet on.

## Process

1. Read the message and, for a reply, its root and siblings in the same list.
2. If it is about the work of exactly one feature, name that feature's directory.
3. If it is chat, thanks, logistics naming nobody, or about the team's tooling rather
   than the product, answer `null`.
4. If it plainly straddles two features, a task table on the projects page, say, answer
   both, most relevant first. Never more than two.

## Rules

### The directory, as listed
Answer with a feature directory exactly as listed (`admin/usage`, `tasks`), never a name.

### A thread is one place
Every message in a thread goes where its root goes. Decide the root, then follow it.

### Huddle notes belong to the feature they mostly discuss
A meeting about three features goes to the one it spends the most words on; the reader
of that feature will see the rest.

### Bet or abstain
`null` is a valid answer and costs nothing; a wrong feature costs the thread. Two
features is for a thread that is about both, not for a guess between them. A thread the
user marked as nothing never reaches you again; leave what looks like chat to them.

## Output

One JSON object, nothing else: `{ "<message id>": { "feature": "<dir>" | ["<dir>", "<dir>"] | null, "note"?: "<why, one clause>" }, ... }`
