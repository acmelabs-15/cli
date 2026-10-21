# Research notes

This folder holds the research behind the ACMElabs CLI spec. The spec interview ran on 2026-10-19 and 2026-10-20. Each note gives the facts, versions, dates and sources as they were found. A fact marked UNVERIFIED was not confirmed.

| File | Question it answers | Date | Spec decision it fed |
|---|---|---|---|
| [01-acmelabs-repos.md](01-acmelabs-repos.md) | What do the ACMElabs repos hold today, and how far do their copies of the release machinery drift? | 2026-10-19, 2026-10-20 | 1 scope, 3 hosts, 4 repo kinds, 5 `new` on GitHub (ruleset, Actions setting), the plugins in new repos |
| [02-github-actions-and-configs.md](02-github-actions-and-configs.md) | How do reusable workflows, pinning, tokens, the oxlint and oxfmt configs, tsconfig and `claude plugin validate` work today? | 2026-10-20 | 1 scope, 2b presets, 6 workflow pinning |
| [03-npm-and-distribution.md](03-npm-and-distribution.md) | Who owns the npm names, and how can repos get and run the CLI? | 2026-10-20 | 2a how repos get the CLI, 2b presets, 2c `create-acmelabs`, library packages |
| [04-npm-scope-login-trust.md](04-npm-scope-login-trust.md) | Can a CLI create an npm scope, log in, publish a first version and set up trusted publishing? | 2026-10-20 | npm scope setup in `new`, first publish, what CI may publish |
| [05-command-frameworks.md](05-command-frameworks.md) | Which command framework and prompt library fit the CLI, and does `@bomb.sh/router` work on Bun? | 2026-10-20 | 8 command structure, the argument parser |
| [06-tui-foundations.md](06-tui-foundations.md) | Which foundation fits a Bubbles-style TUI, and what is the state of `@clack/ui`? | 2026-10-20 | The TUI base, the use of the `@clack/ui` preview |
| [07-oxc-without-node.md](07-oxc-without-node.md) | Do oxlint and oxfmt load a TypeScript config under Bun with no Node on PATH? | 2026-10-20 | Open question 4 (`config-presets`); task 2 of the repo-model plan |
| [08-presets-in-a-consumer-repo.md](08-presets-in-a-consumer-repo.md) | How does a repo run the gate on Bun, get the tool binaries, and build on a shared preset? | 2026-10-20 | Open questions 4 and 18; the `config-presets` spec |
| [09-github-steps.md](09-github-steps.md) | How do gh, the GitHub REST API, rulesets, the Actions setting, pull requests and workflow runs behave, and how did acmelabs-15/cli get made? | 2026-10-20 | The `github-ops` spec; ADR-0014 |
| [10-outside-program-limits.md](10-outside-program-limits.md) | Which environment variables do outside programs need, and how can acmelabs limit a program's or a request's time and output on Bun? | 2026-10-20 | Open questions 21 and 22; the `github-ops` spec; ADR-0015 |
| [11-packages-for-the-command-runtime.md](11-packages-for-the-command-runtime.md) | Which packages could replace the command runtime's custom code (citty, the router, incur, execa, ky and others), and what stays custom? | 2026-10-20 | Peter's choice to keep the custom code; `sleep` on `node:timers/promises` |
| [12-git-and-github-packages.md](12-git-and-github-packages.md) | How do we stop git's variables from moving acmelabs's git calls, and which git and GitHub packages would cut custom code? | 2026-10-20 | ADR-0016: git calls run without the GIT_ variables; no package adopted |
| [13-npm-registry-steps.md](13-npm-registry-steps.md) | How do npm's stage publish, trusted publisher, web login, registry reads, org creation and error answers behave, with real answer bodies? | 2026-10-20 | The `npm-ops` spec |
| [14-npm-tools-under-bun.md](14-npm-tools-under-bun.md) | How do the npm CLI, npm's libraries and Bun's own npm commands behave under Bun, and who holds the token in each way? | 2026-10-20 | The `npm-ops` spec: how acmelabs reaches npm |

The probe folders in the session scratchpad (`router-probe`, `tui-probe`, `clack-ui-preview`, `npm12`, `apidocs`, `verify`, `npm-protocol`, `npm-tools`) are temporary. They are not kept. The notes here keep their results.
