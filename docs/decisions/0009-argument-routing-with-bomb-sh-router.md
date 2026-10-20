# Direct calls are routed by @bomb.sh/router

Decided by Peter on 2026-10-20 (spec interview, Q8b then Q8c). Status: accepted.

`@bomb.sh/router` turns a direct call's arguments into a typed intent (help, version or execute, at a route such as `/version/sync`), and the CLI's own code runs the command. Peter first chose gunshi, then chose bombshell's router to stay in one family with tty and clack. A probe on Bun 1.4.0 showed it works: the root help lists every command, nested routes list their own commands, and a positional named `version` binds with no clash. The router validates inputs through Standard Schema, so the command list's input schemas feed it directly.

## Consequences

- Options bind to the route that declares them. `--json` must be declared on every command, through one shared group, so it works after the command name.
- `@bomb.sh/args` is not added. Peter asked for it with the router; the router turned out to have its own tokenizer, so one parser decides what each argument means. args comes back only for a real job (Peter, 2026-10-20).
