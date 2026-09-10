# fixtures

Real material, kept so the ladder is tested against what the channel actually says rather
than against an idea of it. Both are from 2026-09-09.

- `pull-2026-09-09.json` — one `slack-pull --json --no-next` over that day: six top-level
  messages, two threads, no noise. Three of the six name the reader; one carries the
  huddle canvas as a file the transcript deliberately does not contain.
- `huddle-2026-09-09.md` — that canvas, as `slack_read_file` returns it. Raw `<@U…>` ids,
  a Summary of nested bullets and a flat list of action items, which is what a reader
  works from.
- `huddle-2026-09-09.points.json` — the key points a reader wrote from that canvas, in
  the shape `marauder huddle --points` takes: five things the meeting settled, asked for
  or dated, and two lines of small talk marked `chat`. The one file here a person wrote.

The pull and the canvas are never edited. Refreshing them means re-pulling a day and saying which day it is here.
