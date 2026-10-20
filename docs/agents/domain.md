# Domain docs

How brain's skills read this repo's domain documentation. Layout: single-context.

## Before you name a domain concept, read these

- `CONTEXT.md` at the repo root: the glossary, one term per entry, with the words to avoid.
- `CONTEXT-MAP.md` at the repo root, when it exists: the repo has several contexts, and the map points to the `CONTEXT.md` for each. Read the one your topic belongs to.
- `docs/decisions/`: the decision records (ADRs) that touch the area you work in. In a multi-context repo, also `src/<context>/docs/decisions/`.

If a file is absent, proceed without it and do not suggest creating it. The domain-modeling skill creates `CONTEXT.md` and the first ADR lazily, when a term or a decision is resolved.

## Use the glossary's words

When your output names a domain concept, in a task title, a spec, a test name or a reply, use the term as `CONTEXT.md` defines it. A word the glossary marks _Avoid_ stays out.

A concept the glossary lacks is a signal: either you are inventing a word the project does not use, so reconsider, or there is a real gap, so note it for the domain-modeling skill.

## Flag a decision you contradict

If your output contradicts an ADR, say so where the reader will see it, and say why it is worth reopening. Do not override it in silence.
