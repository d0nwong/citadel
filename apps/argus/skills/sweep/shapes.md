# shapes — the JSON the reader returns

Return one JSON object in a ```json fence. Every field is optional; omit what did not
change. Dates are `YYYY-MM-DD`. Never send an id for a new entry; never send a field not
shown here.

```json
{
  "summary": "one sentence naming what the feature is",
  "story": {
    "health": { "text": "…", "evidence": [ …evidence ] },
    "gaps": { "text": "…", "evidence": [ …evidence ] },
    "requirements": { "text": "…", "evidence": [ …evidence ] },
    "architecture": { "text": "…", "evidence": [ …evidence ] }
  },
  "requirements": {
    "add":    [ { "text": "…", "status": "assumed|confirmed|contradicted", "by": "Foong Leung", "at": "2026-09-10", "evidence": [ …evidence ] } ],
    "update": [ { "id": "R-3", "status": "confirmed|contradicted|retired", "by": "Foong Leung", "at": "2026-09-10", "evidence": [ …evidence ] } ]
  },
  "asks": {
    "add":    [ { "text": "Sam wants a button on draft invoices for due on receipt.", "by": "Sam O", "to": "you", "at": "2026-09-09",
                  "origin": { "kind": "slack", "url": "<permalink of the root>", "thread": "<root ts>" }, "requirements": ["R-3"] } ],
    "update": [ { "id": "A-1", "status": "answered|built|acknowledged|closed|dropped", "at": "2026-09-10", "evidence": [ …evidence ] } ]
  },
  "tickets":   { "clear": [ { "key": "ALD-41", "blocker": 0, "at": "2026-09-10", "deployed": true, "evidence": [ …evidence ] } ] },
  "landings":  { "link": [ { "ref": "be#771", "asks": ["A-1"] } ] },
  "proposals": { "add": [ { "kind": "ticket", "title": "[FE] …", "body": "## Summary\n…", "asks": ["A-2"], "at": "2026-09-10" } ] },
  "notes": [ "what you could not settle, one clause each" ]
}
```

Evidence, exactly one of:

```json
{ "kind": "slack", "url": "<permalink>", "quote": "<the words, optional>" }
{ "kind": "pr", "repo": "fe|be", "number": 421, "url": "<pr url>" }
{ "kind": "commit", "repo": "fe|be", "sha": "<sha>" }
{ "kind": "file", "repo": "fe|be", "sha": "<sha>", "path": "src/…", "line": 42 }
{ "kind": "ticket", "key": "ALD-41" }
{ "kind": "assumption", "note": "<why you assume it>" }
```

`by` is the asker's name, or `"someone"` when the message does not say. An ask `update`
may omit `status` to add evidence without moving it. `to` is a first name, `"you"` for
the user, or `null`. `blocker` is the index in the
ticket's blockers list. Landings are already on the ledger when you read it; `link` names
the asks a landing served. `origin.kind` is `slack` or `huddle`. A permalink is the
`https://alden-studios.slack.com/archives/…` link printed on the message.
