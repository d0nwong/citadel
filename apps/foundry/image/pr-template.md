<!--
foundry's canonical PR description template. Bind-mounted into every job
container at /usr/local/share/foundry/pr-template.md so PRs come out the same
shape on every forge — Bitbucket has no repo-level PR template convention, so
without this only GitHub repos that ship their own template get structure.
A repo's own PR template still wins when one exists; this is the default.

Fill every section for real, delete these comments and any section that is
genuinely empty. Written by the agent to /work/.git/PR_BODY.md.
-->

Closes <!-- ticket id, e.g. LIA-38 — delete the line if there is no ticket -->

## Summary

<!-- What changed and why, a short paragraph a reviewer can trust. -->

## Changes

<!-- Bullet the notable edits, grouped by file or area. -->

## Assumptions

<!-- Decisions made without a human to ask — each one stated plainly. -->

## How verified

<!-- What was actually run: tests, typecheck, build, manual checks — and the result. -->
