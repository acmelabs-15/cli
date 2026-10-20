# Issue tracker: local markdown

Adapted from mattpocock/skills, MIT, commit c55ee46.

Issues for this repo live as markdown files under `.scratch/`. The spec and the plan do not: they live at `SPEC.md` or under `spec/`, and under `tasks/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- One file per issue at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never one combined file
- Triage state is a `Status:` line near the top of each issue file; the role strings are in `triage-labels.md`
- Comments append at the bottom under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/issues/`, creating the directory if needed.

## When a skill says "fetch the relevant issue"

Read the file at the path the user gave.

## When a skill says "list the issues in a bucket"

Scan `.scratch/*/issues/*.md` and match the `Status:` line.

## Wayfinding operations

Used by the wayfinder skill. The map is one file with one child file per ticket.

- Map: `.scratch/<effort>/map.md`, the Notes, Decisions so far and Fog body.
- Child ticket: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the type: `research`, `prototype`, `interview` or `task`. A `Status:` line records `claimed` or `resolved`.
- Blocking: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- Frontier: scan `.scratch/<effort>/issues/` for files that are open, unblocked and unclaimed; the lowest number wins.
- Claim: set `Status: claimed` and save before any work.
- Resolve: append the answer under `## Answer`, set `Status: resolved`, then append one line, gist and link, to Decisions so far in `map.md`.
