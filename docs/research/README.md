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

The probe folders in the session scratchpad (`router-probe`, `tui-probe`, `clack-ui-preview`, `npm12`, `apidocs`, `verify`) are temporary. They are not kept. The notes here keep their results.
