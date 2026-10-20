# Outside programs keep the whole environment, and run under time and output limits

Partly superseded by ADR-0016: git calls run without git's GIT_ variables.

Decided by Peter on 2026-10-20 (module `github-ops`, open questions 21 and 22, deferred from the `command-core` review, findings 9 and 10).

Every program that acmelabs starts gets the whole environment, as before: no variable is removed. Every program and request runs under limits that a call can change: 5 minutes per program, 1 minute per request, and 10 MB per output stream and per response body. At a limit, acmelabs stops the program and every program it started, and the command ends with exit 3 and a message that names the limit. Before, nothing limited a program: a 200 MB flood used 599 MB, and a program's own child kept acmelabs waiting 10 seconds after a cancel (`docs/research/10-outside-program-limits.md`).

## Considered options

- **Remove each variable whose name holds TOKEN, SECRET, KEY or PASSWORD**, the redaction's rule, with a per-call way to pass one back. The agent's recommendation, so that a validator never sees `GH_TOKEN` or an npm token. Peter chose no filter. A review that finds "child programs inherit every environment variable" meets this record.
- **Keep only a fixed list of names.** Rejected: it breaks programs that need an unlisted variable (gh, git and agy without `HOME`; gemini and npm without `node` on `PATH`).
- **A time limit only, or no limits.** Rejected: a flood fills memory, and a hang waits until CI's 6-hour job limit.

## Consequences

- A slow but healthy call, such as a first `bun install`, raises its own limit.
- Each program runs in its own process group, so acmelabs stops the group itself on a cancel.
- Linux is UNVERIFIED; `shared-workflows` proves the limits in CI.
