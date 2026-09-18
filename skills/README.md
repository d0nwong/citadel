# skills

Skills that are the operator's, not an app's. `apps/argus/skills/` is argus's own — every skill
there is record work, and `argus/scripts/sync-skills.ts` links all of it into `~/.claude/skills`
unfiltered, so nothing that writes product code belongs in that directory. `prototyping` and
`office-hours` moved here for that reason (CTD-252): the first writes code, the second triages
PRs on GitHub — neither is asking, scoping, ticketing or revising a spec.

Nothing installs this directory. To use a skill here from a terminal, link it into
`~/.claude/skills` by hand:

```sh
ln -s "$(pwd)/skills/prototyping" ~/.claude/skills/prototyping
```
