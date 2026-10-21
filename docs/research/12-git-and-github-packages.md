# Git and GitHub packages, and git's repo variables

What this is: research for Peter's question of 2026-10-20: "we should be able to handle this correctly and reliably and safely - I'll ask again if there are other established packages that can help us with this that would allow us to have significantly less custom code - provide a more robust and reliable solution". The trigger is git's variables, such as `GIT_DIR`, that a git hook exports: with them set, a git call that acmelabs runs in a folder can work in another repo. The note collects the facts on (1) the established way to stop that, (2) git libraries, (3) GitHub API clients, and (4) what each one would replace in `packages/cli/src/github/`. It decides nothing. Researched on 2026-10-20 by a research agent, with Exa, `gh api` GET reads of public source, the npm registry, the installed man pages, and probes. No call wrote to GitHub.

Words in this note:

- **git's local variables:** the 15 names that `git rev-parse --local-env-vars` prints on git 2.54.0 (section 1.1). git's own code calls them "local-repo GIT_* variables".
- **the GIT_ variables:** every environment variable whose name starts with `GIT_`.
- **the second repo:** in the probes, a repo B that a variable points at, while acmelabs asks about repo A.

`CONTEXT.md` has no word for these variables (see "Gaps").

Probe machine: macOS (Darwin 25.6.0), arm64, Bun 1.4.0 (`34cbb9a40`), git 2.54.0 (Apple Git-157, `/usr/bin/git`), gh 2.98.0. Each package was installed alone with `bun add` in its own folder. Package counts come from Bun's install line, and sizes from `du -sk node_modules`. The probe scripts sit in the session scratchpad (`git-probe/`). They are temporary; this note keeps their results.

## Summary

**(a) The most robust way to stop git's variables from moving acmelabs's git calls.** Remove the GIT_ variables from the environment of each git call that acmelabs starts. Then add back only what acmelabs itself sets, such as `GIT_TERMINAL_PROMPT=0`. The evidence:

- git documents this as the way. githooks(5): a hook that runs git "in a foreign repository ... should clear these environment variables", with the example `unset $(git rev-parse --local-env-vars); git -C ../foreign-repo describe` (section 1.1).
- git's own code does it wherever it runs git in another repo: `sanitize_repo_env` for submodules and `git for-each-repo`. git fixed `for-each-repo` for this exact bug on 2026-03-03 (section 1.5).
- pre-commit removes every GIT_ variable except a short list of transport variables. simple-git 4.0.0 (2026-09-25) removes every inherited GIT_ variable by default (section 1.5).
- The same bug, fixed the same way, is on record in golangci-lint, Flutter, worktrunk and others. golangci-lint's `git clone` in a hook wiped the user's staged changes (section 1.6).
- **The probe (section 1.3):** `-C <folder>` fixed none of the cases. `--git-dir` and `--work-tree` fixed `GIT_DIR` only. Clearing git's 15 local variables fixed every case except `GIT_REFERENCE_BACKEND` (new in git 2.54.0, and missing from git's own list on master too) and `GIT_CONFIG_GLOBAL`. Removing all GIT_ variables fixed every case.
- A library that opens a repo by its path is immune by design: isomorphic-git, es-git and `@napi-rs/simple-git` gave the right answer under every variable (section 2.2). Each one needs the token in acmelabs for a push (section 2.3).

The option that Peter called hacky, (A), used git's own list. It is git's documented method. The probe found one gap in that list. The broader form (all GIT_ variables, as pre-commit and simple-git do) closes it. Either form needs a World change: `SpawnOptions.env` can add a variable but cannot remove one, and ADR-0015 says that no variable is removed (section 1.7).

**(b) Packages that would cut custom code, and their cost.** None cuts it significantly. The github code is 907 code lines; about two thirds of them are ACMElabs's own rules (section 4.3).

| Package | Lines it could save (estimate, not built) | Cost |
|---|---|---|
| Octokit (`@octokit/core` 7.0.8 and four plugins) | about 100 to 190 of the 907 | 19 packages (24 MB installed, 138 KB bundled). It needs a token in acmelabs, which reverses ADR-0014, or a fetch that runs `gh api -i` (probed: it works, section 3.4). Its retry and rate-limit waits use their own timers, outside `World.sleep` and the fake clock. A World limit becomes a `RequestError` with status 500, which plugin-retry then retries. Every test's scripted answer changes form |
| simple-git 4.0.2 | under 50 (git.ts is 27 lines; push and clone are not written) | It starts git itself, outside the World's limits and `fakeWorld`'s log. `raw()` gives `""` for exit 0 and for exit 1 alike. gh's helper flags need `allowUnsafeCredentialHelper` |
| isomorphic-git 1.44.3, es-git 0.7.0, `@napi-rs/simple-git` 1.2.0 | under 50 | Each takes the token as a password for push, so acmelabs holds it (ADR-0014). They run in the acmelabs process: no process group and no output limit. Tests need real repos. es-git and `@napi-rs/simple-git` add a native binary per platform (about 6 MB) |
| dugite 3.2.3, nodegit | none | dugite passes the environment through (the `GIT_DIR` case failed) and downloads a 148 MB git. nodegit does not load on Bun 1.4.0 |

**(c) What no package covers.** The read-before-write rules and the re-run rule of each step; Protect main's compare; the Actions setting's compare; the PR reuse and its 422 race; the workflow run wait with its deadlines; the tag peel; the table from GitHub's answers to failure kinds and exit codes; the name checks; `checkLogin` through `gh auth status`; and `fakeWorld` as the test seam (section 4.3).

## 1. git's variables: the established way

### 1.1 What git's docs say

From the man pages of git 2.54.0 on this machine (`/Applications/Xcode.app/Contents/Developer/usr/share/man/`); the same text is at https://git-scm.com/docs.

- githooks(5): "Before Git invokes a hook, it changes its working directory to either $GIT_DIR in a bare repository or the root of the working tree in a non-bare repository." https://git-scm.com/docs/githooks
- githooks(5), the next paragraph, whole:

  > Environment variables, such as GIT_DIR, GIT_WORK_TREE, etc., are exported so that Git commands run by the hook can correctly locate the repository. If your hook needs to invoke Git commands in a foreign repository or in a different working tree of the same repository, then it should clear these environment variables so they do not interfere with Git operations at the foreign location. For example:
  >
  > ```
  > local_desc=$(git describe)
  > foreign_desc=$(unset $(git rev-parse --local-env-vars); git -C ../foreign-repo describe)
  > ```

- git-rev-parse(1), `--local-env-vars`: "List the GIT_* environment variables that are local to the repository (e.g. GIT_DIR or GIT_WORK_TREE, but not GIT_EDITOR). Only the names of the variables are listed, not their value, even if they are set." https://git-scm.com/docs/git-rev-parse
- git(1), `-C <path>`: "Run as if git was started in <path> instead of the current working directory." It says nothing about the variables. https://git-scm.com/docs/git
- git(1), `--git-dir=<path>`: "Set the path to the repository (".git" directory). This can also be controlled by setting the GIT_DIR environment variable." git(1), under GIT_DIR: "The --git-dir command-line option also sets this value." So the flag sets the variable, and wins over it.
- git(1), `--work-tree=<path>`: "This can also be controlled by setting the GIT_WORK_TREE environment variable and the core.worktree configuration variable."
- git(1), GIT_COMMON_DIR: "If this variable is set to a path, non-worktree files that are normally in $GIT_DIR will be taken from this path instead. ... This variable has lower precedence than other path variables such as GIT_INDEX_FILE, GIT_OBJECT_DIRECTORY..." git(1) lists no flag for GIT_COMMON_DIR, GIT_OBJECT_DIRECTORY, GIT_ALTERNATE_OBJECT_DIRECTORIES or GIT_INDEX_FILE.
- git(1), GIT_REFERENCE_BACKEND: "Specify which reference backend to be used along with its URI. See extensions.refStorage option in git-config(1) for more details. Overrides the config variable when used." git-config(1), `extensions.refStorage`: for the files and reftable backends, the payload "must be a filesystem path where the references will be stored".
- git-config(1), GIT_CONFIG_COUNT: its pairs "will override values in configuration files, but will be overridden by any explicit options passed via git -c." GIT_CONFIG: "This variable has no effect on other Git commands" than `git config`.
- The flags that match a variable: `--git-dir` (GIT_DIR), `--work-tree` (GIT_WORK_TREE), `--namespace` (GIT_NAMESPACE), `--no-replace-objects` (GIT_NO_REPLACE_OBJECTS), `-c` (adds to the config variables, does not clear them). (git(1), OPTIONS)

**The list on git 2.54.0** (`git rev-parse --local-env-vars`): `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_CONFIG`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`, `GIT_OBJECT_DIRECTORY`, `GIT_DIR`, `GIT_WORK_TREE`, `GIT_IMPLICIT_WORK_TREE`, `GIT_GRAFT_FILE`, `GIT_INDEX_FILE`, `GIT_NO_REPLACE_OBJECTS`, `GIT_REPLACE_REF_BASE`, `GIT_PREFIX`, `GIT_SHALLOW_FILE`, `GIT_COMMON_DIR`. The list comes from `local_repo_env[]` in https://github.com/git/git/blob/v2.54.0/environment.c (lines 109-126).

**A gap in git's list:**

- `GIT_REFERENCE_BACKEND` is not in `local_repo_env[]`, at v2.54.0 or on master (read 2026-10-20). setup.c reads it at v2.54.0 (lines 2032 and 2745). https://github.com/git/git/blob/v2.54.0/setup.c
- v2.53.0's `environment.h` does not define it; v2.54.0's does (line 46).
- On master, commit `768ec52864` (2026-09-09) renames it to `GIT_REF_STORAGE_FORMAT` and keeps the old name as an alias. The new name is not in the list either. https://github.com/git/git/commit/768ec52864
- The probe in 1.3 shows its effect: HEAD comes from the second repo, and clearing git's list does not stop it.

### 1.2 What each hook exports on git 2.54.0 (probe)

A repo with a hook for each event, a linked worktree, and a bare remote with receive hooks. Each hook wrote `env | grep ^GIT_` to a file. The probe set `GIT_AUTHOR_*`, `GIT_COMMITTER_*`, `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_NOSYSTEM` itself; they are left out below.

| Hook | GIT_ variables that git added |
|---|---|
| pre-commit, prepare-commit-msg, commit-msg, post-commit, in a plain repo | `GIT_INDEX_FILE=.git/index` (relative), `GIT_PREFIX=`, `GIT_EDITOR=:`, `GIT_AUTHOR_DATE`, `GIT_EXEC_PATH` |
| The same hooks in a linked worktree | as above, plus `GIT_DIR=<repo>/.git/worktrees/wt`, and `GIT_INDEX_FILE` absolute: `<repo>/.git/worktrees/wt/index` |
| pre-push, in a plain repo | `GIT_PREFIX=`, `GIT_EXEC_PATH` |
| post-checkout and reference-transaction, after `git -c core.hooksPath=.git/hooks worktree add` | `GIT_CONFIG_PARAMETERS='core.hooksPath'='.git/hooks'`: the outer command's `-c` |
| reference-transaction, in a linked worktree | `GIT_DIR` absolute |
| pre-receive, on the bare remote | `GIT_DIR=.`, `GIT_OBJECT_DIRECTORY=<objects>/tmp_objdir-incoming-...`, `GIT_ALTERNATE_OBJECT_DIRECTORIES=<objects>`, `GIT_QUARANTINE_PATH`, `GIT_PUSH_OPTION_COUNT=0` |
| update, post-receive, on the bare remote | `GIT_DIR=.` |

- So a hook in a linked worktree gives acmelabs an absolute `GIT_DIR` and an absolute `GIT_INDEX_FILE`. Claude Code and other agents often work in linked worktrees.
- Every commit hook gives `GIT_INDEX_FILE`. In a plain repo it is relative, so it resolves inside whatever folder git runs in.

### 1.3 Which way of naming the folder stops which variable (probe)

Repos A and B, each with three commits and a local bare origin. Each variable points at B. Each command runs with the folder A named in one of five ways. The five ways:

1. **cwd:** the spawn's working folder is A, as `inLocalHistory` runs git today.
2. **-C:** `git -C A ...`, as gh's own git client does (section 1.5).
3. **flags:** `git --git-dir=A/.git --work-tree=A ...`.
4. **git's list:** the 15 names of section 1.1 removed from the environment.
5. **all GIT_:** every GIT_ variable removed, except pre-commit's allowlist (section 1.5).

The right answers: `merge-base --is-ancestor <B's HEAD> HEAD` exits 128 (A does not know the commit), so ensureRepo reads "no"; `merge-base --is-ancestor <A's first commit> HEAD` exits 0; `rev-parse HEAD` gives A's HEAD; `push --dry-run --porcelain origin` names A's origin.

| Variable, pointing at B | cwd | -C | flags | git's list | all GIT_ |
|---|---|---|---|---|---|
| `GIT_DIR` | **wrong "yes"** (exit 0); HEAD is B's; push goes to B's origin | **the same** | right | right | right |
| `GIT_WORK_TREE` | right, for these commands | right | right | right | right |
| `GIT_COMMON_DIR` | A's own commit unknown (128); push goes to **B's origin** | the same | **the same** | right | right |
| `GIT_OBJECT_DIRECTORY` | A's own commit unknown (128) | the same | the same | right | right |
| `GIT_ALTERNATE_OBJECT_DIRECTORIES` | B's commit is "no" (exit 1, not 128) | the same | the same | right | right |
| `GIT_GRAFT_FILE` (A's first commit gets B's HEAD as parent) with `GIT_ALTERNATE_OBJECT_DIRECTORIES` | **wrong "yes"** (exit 0) | **the same** | **the same** | right | right |
| `GIT_SHALLOW_FILE` (cuts A's history) | A's first commit is "no" (exit 1) | the same | the same | right | right |
| `GIT_INDEX_FILE`, `GIT_CONFIG`, `GIT_IMPLICIT_WORK_TREE=0`, `GIT_PREFIX`, `GIT_NAMESPACE` | right, for these commands | right | right | right | right |
| `GIT_REFERENCE_BACKEND=files://B/.git` (not in git's list) | HEAD is **B's**; A's own commit unknown (128) | the same | the same | **the same** | right |
| `GIT_CONFIG_GLOBAL` with a `pushurl` (not in git's list) | push goes to **B's origin** | the same | the same | **the same** | right |

The config variables, probed with cwd only (the flags do not touch config):

| Variable | Result |
|---|---|
| `GIT_CONFIG_PARAMETERS="'remote.origin.url'='B-origin'"` | push goes to **both** A's origin and B's origin |
| `GIT_CONFIG_PARAMETERS` or `GIT_CONFIG_COUNT` with `remote.origin.pushurl` | push goes to **B's origin** only |
| the same `GIT_CONFIG_COUNT`, plus `-c remote.origin.pushurl=` on the command line | push goes to A's origin: the command line's `-c` wins |
| `GIT_CONFIG_PARAMETERS` with `url.<B>.insteadOf=https://github.com/acmelabs-15/x.git` | `git ls-remote --get-url` of the github.com URL gives B's path |
| `GIT_CONFIG_PARAMETERS` or `GIT_CONFIG_COUNT` with a `credential.https://github.com.helper` | `git config --get-all` lists that helper, then acmelabs's empty value, then gh's helper. The empty value resets the list, so gh's helper is the one that runs. gitcredentials(7): "If credential.helper is configured to the empty string, this resets the helper list to empty" |
| pre-commit's allowlist (it keeps `GIT_CONFIG_COUNT` and its keys) with a `pushurl` | push goes to **B's origin**. With all GIT_ variables removed: A's origin |

What this shows:

- `-C` is not a fix: git still reads `GIT_DIR` and the others.
- `--git-dir` and `--work-tree` cover two variables. No flag covers `GIT_COMMON_DIR`, the object variables, the graft and shallow files, or the config variables.
- Clearing git's list covered the 15 names it holds. It missed `GIT_REFERENCE_BACKEND` and `GIT_CONFIG_GLOBAL`.
- Removing every GIT_ variable gave the right answer in every case. A short allowlist that keeps `GIT_CONFIG_COUNT` brings back the push redirect.
- A check before the call cannot catch every case. With `GIT_DIR` pointing at B, `git rev-parse --show-toplevel` still printed A; only `--absolute-git-dir` printed B. With `GIT_REFERENCE_BACKEND`, no path that `rev-parse` prints changed.

### 1.4 git clone under a hook's variables (probe)

The planned `clone` step runs `git clone <url> <folder>`. The probe cloned B's origin into a new folder, with one variable set at a time:

| Variable | Result |
|---|---|
| `GIT_DIR=A/.git` | The clone made its own `.git`; A did not change |
| `GIT_WORK_TREE=A` | `fatal: working tree '<A>' already exists.` No clone |
| `GIT_INDEX_FILE=.git/index` (relative, as in a plain repo's commit hook) | The clone was right |
| `GIT_INDEX_FILE=<A>/.git/index` (absolute, as in a worktree's commit hook) | The clone wrote its index into **A's index**: A's `git status` showed `MM f`. A's staged changes were lost |
| `GIT_OBJECT_DIRECTORY=A/.git/objects` | `fatal: update_ref failed for ref 'HEAD': ... nonexistent object`. No clone |
| `GIT_DIR` or the absolute `GIT_INDEX_FILE`, after `unset $(git rev-parse --local-env-vars)` | The clone was right, and A did not change |

The absolute `GIT_INDEX_FILE` case is the golangci-lint report in section 1.6.

### 1.5 How git itself and established tools handle it (from their source)

| Tool, version | What it does |
|---|---|
| git 2.54.0 | Clears its list for each git it runs in another repo (submodules, `for-each-repo`, branch, promisor-remote), and keeps `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_COUNT` |
| pre-commit 4.7.0 | Removes every GIT_ variable except 9 names and the `GIT_CONFIG_KEY_*` and `GIT_CONFIG_VALUE_*` pairs |
| simple-git 4.0.2 | Removes every inherited GIT_ variable, and `EDITOR`, `PAGER`, `PREFIX`, `SSH_ASKPASS` and `VISUAL`, unless the caller allows a name |
| lint-staged 17.6.0 | Deletes `GIT_DIR` and `GIT_WORK_TREE` from its own process |
| gh 2.102.1 | Passes `-C <repo>` and the whole environment |
| husky 9.1.7 | Runs the hook script with the whole environment |
| dugite 3.2.3 | Passes the whole environment, plus its own variables |
| VS Code's git extension | Passes the whole environment, plus its own variables |
| changesets, semantic-release 25.0.9, `@npmcli/git` 8.0.0 | Pass the working folder and the whole environment |

**git.** `run-command.h` at v2.54.0, lines 536-549 (https://github.com/git/git/blob/v2.54.0/run-command.h):

```c
/**
 * Unset all local-repo GIT_* variables in env; see local_repo_env in
 * environment.h. GIT_CONFIG_PARAMETERS and GIT_CONFIG_COUNT are preserved
 * to pass -c and --config-env options from the parent process.
 */
void sanitize_repo_env(struct strvec *env);

/**
 * Convenience function which prepares env for a command to be run in a
 * new repo. This removes variables pointing to the local repository (using
 * sanitize_repo_env() above), and adds an environment variable pointing to
 * new_git_dir.
 */
void prepare_other_repo_env(struct strvec *env, const char *new_git_dir);
```

- `prepare_other_repo_env` is used in `submodule.c`, `branch.c` and `promisor-remote.c`; `sanitize_repo_env` in `builtin/for-each-repo.c` (GitHub code search in git/git, 2026-10-20).
- `builtin/for-each-repo.c` at v2.54.0, lines 17-26: `sanitize_repo_env(&child.env);`, then `strvec_pushl(&child.args, "-C", abspath, NULL);`. So git uses `-C` and clears the variables; `-C` alone is not enough.
- Commit `2ef539bcee`, "for-each-repo: work correctly in a worktree" (Derrick Stolee, 2026-03-03): "We need to be careful to unset the local Git environment variables and let the child process rediscover them ... Update run_command_on_repo() to use the new sanitize_repo_env() helper method to erase these environment variables. During review of this bug fix, there were several incorrect patches demonstrating different bad behaviors." https://github.com/git/git/commit/2ef539bcee
- git's test helper `t/t5801/git-remote-testgit`, line 29: `unset $(git rev-parse --local-env-vars)`.
- `git-sh-setup.sh` at v2.54.0 no longer has a `clear_local_git_env` function (`grep` finds none). `git-submodule.sh` dropped its `sanitize_submodule_env()` in commit `85775255f1` (2022-06-28).

**pre-commit** (latest release v4.7.0, 2026-10-13), `pre_commit/git.py` on main, lines 27-48 (https://github.com/pre-commit/pre-commit/blob/main/pre_commit/git.py):

```python
def no_git_env(_env: Mapping[str, str] | None = None) -> dict[str, str]:
    # Too many bugs dealing with environment variables and GIT:
    # https://github.com/pre-commit/pre-commit/issues/300
    # In git 2.6.3 (maybe others), git exports GIT_WORK_TREE while running
    # pre-commit hooks
    # In git 1.9.1 (maybe others), git exports GIT_DIR and GIT_INDEX_FILE
    # while running pre-commit hooks in submodules.
    # GIT_DIR: Causes git clone to clone wrong thing
    # GIT_INDEX_FILE: Causes 'error invalid object ...' during commit
    _env = _env if _env is not None else os.environ
    return {
        k: v for k, v in _env.items()
        if not k.startswith('GIT_') or
        k.startswith(('GIT_CONFIG_KEY_', 'GIT_CONFIG_VALUE_')) or
        k in {
            'GIT_EXEC_PATH', 'GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_SSL_CAINFO',
            'GIT_SSL_NO_VERIFY', 'GIT_CONFIG_COUNT',
            'GIT_HTTP_PROXY_AUTHMETHOD',
            'GIT_ALLOW_PROTOCOL',
            'GIT_ASKPASS',
        }
    }
```

- `pre_commit/store.py`, lines 198-203: the clone of a hook repo runs every git with `env = git.no_git_env()` and `cwd=directory`.

**simple-git 4.0.2** (2026-09-26). The 4.0.0 changelog (2026-09-25): "Ambient environment variables are filtered before passing into the `git` child process." Its example: with `process.env.GIT_TEMPLATE_DIR` set, "git child process now sees only FOO". A caller allows a name with `allowEnvironment`. https://github.com/steveukx/git-js/blob/main/simple-git/CHANGELOG.md

- `simple-git/src/lib/git-factory.ts`, lines 59-61, adds the guard to every instance: `plugins.add(allowEnvironmentPlugin(config.allowEnvironment ?? [], config.unsafe?.allowAbbreviatedOptions));`.
- `simple-git/src/lib/plugins/allow-environment.plugin.ts`: for each key that `isGuardedEnvKey` matches (`normalised.startsWith('git_') || isGitEnvKey(normalised)`) and that is not allowed, it deletes the key: `// log and remove guarded keys inherited from the outer environment` ... `delete env[key];`. A guarded key that the caller passes with `.env()` throws instead.
- `packages/argv-parser/src/env/parse-env.ts` lists the other guarded names: `editor`, `pager`, `prefix`, `ssh_askpass`, `visual`.
- The changelog credits about 14 people "for identifying the vulnerability": the change is a security fix.

**lint-staged** (latest v17.6.0, 2026-09-26), `lib/resolveGitRepo.js` on main, lines 41-45:

```js
    // Unset GIT_DIR before running any git operations in case it's pointing to an incorrect location
    debugLog('Unset GIT_DIR (was `%s`)', process.env.GIT_DIR)
    delete process.env.GIT_DIR
    debugLog('Unset GIT_WORK_TREE (was `%s`)', process.env.GIT_WORK_TREE)
    delete process.env.GIT_WORK_TREE
```

**gh** v2.102.1 (2026-10-20), `git/client.go`, lines 78-100 (https://github.com/cli/cli/blob/v2.102.1/git/client.go): `if c.RepoDir != "" { args = append([]string{"-C", c.RepoDir}, args...) }`, then `cmd := commandContext(ctx, c.GitPath, args...)`. It sets no `cmd.Env`, so git gets gh's whole environment. By the probe in 1.3, gh's git calls follow `GIT_DIR` too.

**husky** v9.1.7 (2024-11-18), the hook runner `husky`: `export PATH="node_modules/.bin:$PATH"`, then `sh -e "$s" "$@"`. It passes the hook's environment to the user's script unchanged. https://github.com/typicode/husky/blob/main/husky

**dugite** v3.2.3 (2026-08-11), `lib/git-environment.ts`, `setupEnvironment`: `new EnvMap([...Object.entries(processEnv), ...Object.entries(environmentVariables)])`, then it sets `GIT_EXEC_PATH`, `GIT_CONFIG_SYSTEM`, `GIT_TEMPLATE_DIR` and on Linux `PREFIX` and `GIT_SSL_CAINFO`. `lib/exec.ts`, lines 138-147: `cwd: path, env`. https://github.com/desktop/dugite

**VS Code's git extension**, `extensions/git/src/git.ts` on main (commit `65660d85a2`, 2026-10-17), lines 697-703: `options.env = assign({}, process.env, this.env, options.env || {}, { VSCODE_GIT_COMMAND: args[0], LANGUAGE: 'en', LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8', GIT_PAGER: 'cat' });`. https://github.com/microsoft/vscode/blob/main/extensions/git/src/git.ts

**changesets**, `packages/git/src/index.ts` on main: `exec("git", [...], { nodeOptions: { cwd } })` through tinyexec. **semantic-release** v25.0.9, `lib/git.js`: `execa("git", [...], execaOptions)` with `{ cwd, env }`, where `env` is `{ ...process.env, ...execaOptions.env }` (line 54). **`@npmcli/git`** v8.0.0, `lib/opts.js`: `env: opts.env || { ...finalGitEnv, ...process.env }`.

### 1.6 Reports of the same bug in other tools

Each one names a hook's variables as the cause, and removing them as the fix.

- **golangci-lint #6513:** `golangci-lint custom` in a pre-commit hook ran `git clone`; the child "inherits these variables. The clone's internal checkout then writes its index to `GIT_INDEX_FILE` — which points to the **original repository's index file** — overwriting it". "All staged changes are permanently lost." It was intermittent: "**the first commit in a new worktree**" triggered it. The suggested fix filters the variables "the same approach pre-commit uses internally (`no_git_env()`)". https://github.com/golangci/golangci-lint/issues/6513
- **Flutter #187150:** `flutter --version` in a git hook reported `0.0.0-unknown`, because its git calls "pass `workingDirectory: flutterRoot` but **no `environment:`**", and "**`GIT_DIR` overrides `workingDirectory`**". https://github.com/flutter/flutter/issues/187150
- **worktrunk #3373** (git 2.54.0): forwarded GIT_ variables made user hooks act on "the *inherited* repo/worktree", up to writing `core.worktree` into the wrong repo's config. Fixed in #3374 (comment of 2026-07-05). https://github.com/max-sixty/worktrunk/issues/3373
- **vibe-validate #157:** a validation step in a pre-commit hook rewrote the parent repo's branch refs and `.git/config`. "`git -C` has the same limitation — it changes git's working directory but does not unset `GIT_*`." Proposed fix: "Strip every `GIT_*` env var from the env passed to spawned validation steps". https://github.com/jdutton/vibe-validate/issues/157
- **portree PR #17**, **skiletto PR #21**, **joshjhall/containers #599:** tests and tools in hooks wrote commits to the real branch, or set `core.bare=true` on the real repo. Each strips the routing variables. https://github.com/fairy-pitta/portree/pull/17 · https://github.com/kumekay/skiletto/pull/21 · https://github.com/joshjhall/containers/issues/599
- The dates of these reports, apart from worktrunk's, were not read: UNVERIFIED.

### 1.7 What this means for acmelabs

- `inLocalHistory` (`git.ts`) runs `git merge-base --is-ancestor <sha> HEAD` with `cwd` only. By 1.3, a hook's `GIT_DIR` (a linked worktree's commit hooks set it) or `GIT_COMMON_DIR` can make it answer "yes" for another repo. Then `ensureRepo` reuses a repo that holds other work, and the next steps change its settings.
- The planned `push` runs `git remote`, `git ls-remote` and `git push`. By 1.3, `GIT_DIR`, `GIT_COMMON_DIR` or a config variable can make it push another repo's commits, or push to another remote. The planned `clone` can overwrite another repo's index (1.4).
- **The World cannot remove a variable today.** `SpawnOptions.env` is `Readonly<Record<string, string>>`, and `world-spawn.ts` spawns with `env: { ...Bun.env, ...options.env }`. So a call can add or replace a variable, but not remove one.
- **Bun can.** On Bun 1.4.0, `Bun.spawn` with `env: { ...Bun.env, NAME: undefined }`, or with the key left out, starts the program without `NAME` (probe: `${PROBE_X-<unset>}` printed `<unset>` both ways).
- **ADR-0015 and the spec say "No variable is removed".** That decision was about secrets for every program. Removing git's variables for git's calls is a different reason, but it changes that sentence. So it needs Peter's decision and a record that supersedes part of ADR-0015.
- **Where the removal could sit:** in `git.ts`, for each git command line it builds (as pre-commit, simple-git and git itself do it per call), or in the World for every program that acmelabs starts. gh, `claude plugin validate` and other programs may run git themselves; by 1.5, gh's git calls inherit the environment.
- Removing the variables does not change `GIT_TERMINAL_PROMPT=0`: acmelabs adds it after the removal.
- **What a broad removal takes away:** a GIT_ variable that the user sets on purpose, such as `GIT_SSH_COMMAND`, `GIT_TRACE` or `GIT_CONFIG_GLOBAL`. pre-commit keeps 9 transport names for this reason. acmelabs pushes over HTTPS with gh's helper, so the SSH names do not apply to it. `GIT_SSL_CAINFO` and the proxy names can apply behind a company proxy: UNVERIFIED for ACMElabs's users.
- **Upstream:** `GIT_REFERENCE_BACKEND` (and `GIT_REF_STORAGE_FORMAT` on master) missing from `local_repo_env[]` looks like a defect in git. A report to the git mailing list would fix the cause for every user of `--local-env-vars`. Sending it is an outward-facing step.

## 2. Git libraries

### 2.1 The packages and their state

| Package | Latest (date) | Engine | License | Direct dependencies | Installed: packages, size | Native binaries | Repo: stars, last push, open issues and PRs |
|---|---|---|---|---|---|---|---|
| isomorphic-git | 1.44.3 (2026-10-17) | Pure JavaScript | MIT | 11 | 55, 9.1 MB | none | 8,377; 2026-10-17; 311 |
| es-git | 0.7.0 (2026-05-17); `next` 0.7.0-next.198 (2026-10-12) | libgit2 through git2-rs and napi-rs | MIT | 0, plus 10 optional platform packages | 2, 6.3 MB (darwin-arm64 binary 5.9 MB) | darwin x64 and arm64, linux x64 and arm64 (gnu and musl), win32 x64 and arm64, android arm64 and arm | 332; 2026-10-14; 17 |
| `@napi-rs/simple-git` | 1.2.0 (2026-09-21) | libgit2 through git2-rs and napi-rs | MIT | 0, plus 15 optional platform packages | 2, 5.9 MB (darwin-arm64 binary 5.6 MB) | 15 platforms, freebsd and linux ppc64, s390x, arm among them | 192; 2026-10-19; 1 |
| nodegit | 0.27.0 (2020-07-28); `next` 0.28.0-alpha.38 (2026-04-23) | libgit2 through NAN | MIT | 9 (`node-gyp` 4, `node-pre-gyp` 0.13 among them) | 0.27.0: install failed; alpha: 141 | prebuilt in the alpha | 5,754; 2026-07-16; 367 |
| simple-git | 4.0.2 (2026-09-26) | Starts the git program | MIT | 5 | 7, 2.1 MB | none | 3,856; 2026-09-26; 68 |
| dugite | 3.2.3 (2026-08-11) | Starts its own bundled git | MIT | 2, plus a postinstall download | 14, 158 MB (its git 2.53.0 is 148 MB) | git per platform, downloaded | 522; 2026-09-16; 9 |
| wasm-git | 0.0.17 (2026-07-17) | libgit2 in WebAssembly | not stated in the registry (`NOASSERTION` on GitHub) | 0 | not installed | none | 847; 2026-10-18; 26 |

Sources: `https://registry.npmjs.org/<name>` and `gh api repos/<owner>/<repo>`, read 2026-10-20; the installs.

- **Other candidates searched (Exa, 2026-10-20):** gitoxide is "an implementation of `git` written in Rust"; its README lists push as not done, and no npm binding was found. https://github.com/GitoxideLabs/gitoxide · node-gitteh and `@nullstyle/libgit2` (Deno FFI, marked "vibed" by its author) are not candidates.
- **Bun ran two install scripts by itself:** dugite's postinstall (it downloaded git) and nodegit's install. Both names are on Bun 1.4.0's default trusted list (`src/install/default-trusted-dependencies.txt` at tag `bun-v1.4.0`, lines 153 and 264).

### 2.2 Probe: open repo A by path, run the ancestor check, with a variable pointing at B

Each library ran in a fresh `bun` process, with a clean environment plus one variable. Each run read A's HEAD, then asked "is B's HEAD an ancestor of A's HEAD?" (right: no) and "is A's first commit an ancestor?" (right: yes). The time covers the whole run; the first run of a native library includes its load.

| Library, how it opens A | none | `GIT_DIR` | `GIT_COMMON_DIR` | `GIT_OBJECT_DIRECTORY` | `GIT_REFERENCE_BACKEND` | Time |
|---|---|---|---|---|---|---|
| isomorphic-git, `dir: A` (`isDescendent`) | right | right | right | right | right | 75 ms first, then 28-31 ms |
| es-git, `openRepository(A)` (`getMergeBase`) | right | right | right | right | right | 414 ms first, then 11-12 ms |
| es-git, `openRepository(A, { fromEnv: true })` | right | right | **wrong "yes"**, HEAD is B's | A's own commit throws | right | 11-13 ms |
| `@napi-rs/simple-git`, `new Repository(A)` (a revwalk) | right | right | right | right | right | 353 ms first, then 11-13 ms |
| `@napi-rs/simple-git`, `openExt(A, FromEnv)` | right | right | **wrong "yes"**, HEAD is B's | both throw `NotFound` | right | 11-15 ms |
| nodegit 0.28.0-alpha.38 | does not load on Bun 1.4.0 | | | | | |
| simple-git 4.0.2, `simpleGit(A).raw([...])` | right | right | right | right | right | 111-122 ms (3 git programs) |
| dugite 3.2.3, `exec([...], A)` | right | **wrong "yes"**, HEAD is B's | A's own commit 128 | A's own commit 128 | right (its git is 2.53.0) | 29-35 ms (3 git programs) |

- isomorphic-git reads no environment variable: `process.env` appears once in its bundle, inside a doc comment (`grep` of `index.js`).
- es-git's `fromEnv` doc: "`open` will ignore other options and `ceilingDirs`, and respect the same environment variables git does. Note, however, that `path` overrides `$GIT_DIR`." (`es-git` 0.7.0 `index.d.ts`)
- libgit2's `GIT_REPOSITORY_OPEN_FROM_ENV`: "The opened repository will respect $GIT_INDEX_FILE, $GIT_NAMESPACE, $GIT_OBJECT_DIRECTORY, and $GIT_ALTERNATE_OBJECT_DIRECTORIES. In the future, this flag will also cause `git_repository_open_ext` to respect $GIT_WORK_TREE and $GIT_COMMON_DIR; currently, `git_repository_open_ext` with this flag will error out if either $GIT_WORK_TREE or $GIT_COMMON_DIR is set." https://libgit2.org/docs/reference/main/repository/git_repository_open_flag_t.html · The probe opened B under `GIT_COMMON_DIR` with no error, so the bundled libgit2 differs from that text: UNVERIFIED which libgit2 version each binding bundles.
- nodegit 0.28.0-alpha.38 on Bun 1.4.0: `TypeError: symbol 'napi_register_module_v1' not found in native module. Is this a Node API (napi) module?`. nodegit 0.27.0: its install script ran `node-pre-gyp install --fallback-to-build` with Node 24 from PATH and failed in `node-gyp configure`. Either way it needs Node at install, which the pure-Bun rule excludes.
- simple-git passed every case because its guard removed the variable (section 1.5).
- es-git's `getMergeBase` throws `GenericFailure` for a commit that A does not know, so "unknown" and other failures share one error code.
- **simple-git cannot tell exit 0 from exit 1 through `raw()`.** `merge-base --is-ancestor HEAD HEAD~1` (exit 1, no stderr) resolved with `""`, as exit 0 does. Exit 128 rejected with git's message. The source: `isTaskError(result) { return !!(result.exitCode && result.stdErr.length); }` (`simple-git/src/lib/plugins/error-detection.plugin.ts`, lines 8-10). The `errors` option can change the rule: UNVERIFIED by a probe.

### 2.3 Push and clone over HTTPS: credentials and gh's login

| Library | How it gets credentials | gh's login without acmelabs holding the token? |
|---|---|---|
| git program (today's plan) | git runs gh's credential helper, `-c credential.https://github.com.helper=!gh auth git-credential` (note 09, section 1.5) | Yes: gh gives the token to git, and acmelabs never sees it |
| simple-git 4.0.2 | The same git program, so the same helper | Yes, but only with `unsafe: { allowUnsafeCredentialHelper: true }`. Without it: "Configuring credential.helper is not permitted without enabling allowUnsafeCredentialHelper" (probe) |
| isomorphic-git | An `onAuth(url, auth)` callback that returns `{ username, password }` or `{ headers }`. "Git does all its authentication using HTTPS Basic Authentication." https://isomorphic-git.org/docs/en/onAuth | No: the callback must return the token. acmelabs could get it from `gh auth git-credential` or `gh auth token`, so acmelabs holds it |
| es-git | `credential: { type: 'Plain', password }`, or `Default`, `SSHKeyFromAgent`, `SSHKeyFromPath`, `SSHKey` (`index.d.ts`, `Credential`). No credential-helper type | No |
| `@napi-rs/simple-git` | `Cred.userpassPlaintext`, `sshKeyFromAgent`, `sshKey`, `sshKeyFromMemory`, `default`, `username`. No credential-helper method | No |
| git2-rs (under both) | Has `Cred::credential_helper(config, url, username)`, which "will attempt to parse the user's `credential.helper` configuration, invoke the necessary processes, and read off what the username/password should be". https://docs.rs/git2/latest/git2/struct.Cred.html | Neither binding exposes it. Even if one did, the token would sit in acmelabs's memory |

- isomorphic-git reads only the repo's own config, as far as found: no `~/.gitconfig`, so no credential helper and no `insteadOf` from the user. Its docs list no reading of global config: UNVERIFIED by a probe.
- `@napi-rs/simple-git`'s docs: "`fetchAsync` / `pushAsync` accept data-only options; they do not take `RemoteCallbacks` (JS callbacks can't run on the worker thread). Use the synchronous `fetch()` / `push()` when you need credential or progress callbacks." So a push with credentials blocks Bun's event loop. https://simple-git.napi.rs/docs
- **GET-only probes over HTTPS on Bun 1.4.0** (no push, no clone):
  - isomorphic-git `getRemoteInfo({ protocolVersion: 1 })` of `https://github.com/acmelabs-15/brain.git`: right HEAD and `main`, with `http/web` (204 ms), `http/node` (283 ms), and a 10-line http client over the repo's `realWorld().fetch` (84 ms, one `GET .../info/refs?service=git-upload-pack`).
  - es-git `remote.defaultBranch()` (419 ms) and `@napi-rs/simple-git` `remoteAnonymous(url).connect(Fetch)`, `defaultBranch()` (196 ms): both gave `refs/heads/main`.
  - A push or a clone with any of them: UNVERIFIED (a push writes to GitHub; a clone sends a POST).

### 2.4 Under the World's limits, and `fakeWorld`

| Library | Time limit | Cancel | Output limit | Process group | `fakeWorld` |
|---|---|---|---|---|---|
| git program through `World.spawn` (today) | Yes | Yes | Yes | Yes | Scripted command lines |
| simple-git | `timeout: { block: ms }`: an idle time, "after spawning the process / receiving content" (probe: 356 ms for 300) | `abort: AbortSignal` (probe: 259 ms after an abort at 200 ms) | None. `spawnOptions` is `Pick<SpawnOptions, 'uid' \| 'gid'>` | None found; whether git's own children stop: UNVERIFIED | No: it imports `spawn` from `node:child_process` |
| isomorphic-git | Only on its requests, through a World-based http client | Its http `signal` is "Reserved for future use" (docs) | On requests only | n/a (in-process) | Its requests only; local repo reads need a real repo |
| es-git, `@napi-rs/simple-git` | Only through `AbortSignal` on async calls; whether an abort stops libgit2 inside a network call: UNVERIFIED | `signal` on async calls | None | n/a (in-process) | No; tests need real repos |
| dugite | `signal` | `signal` | `maxBuffer`, default `Infinity` | No | No |

- Sources: simple-git `src/lib/types/index.ts` (lines 67-144); isomorphic-git's http docs (https://isomorphic-git.org/docs/en/http); es-git and `@napi-rs/simple-git` `index.d.ts`; dugite `lib/exec.ts`.
- The spec already plans real git repos in temp folders for `inLocalHistory`'s test (spec, "Prior-art tests"), so a library's tests could do the same.

## 3. GitHub API clients

### 3.1 The packages

| Package | Latest (date) | Direct dependencies | Installed alone: packages, size | Bundled with `bun build --minify` | Repo: stars, last push, open |
|---|---|---|---|---|---|
| `@octokit/core` | 7.0.8 (2026-08-30) | 7 | 12, 6.4 MB | 20.8 KB | 1,286; 2026-10-20; 20 |
| `@octokit/core` with `plugin-rest-endpoint-methods` 18.0.0, `plugin-paginate-rest` 16.0.0, `plugin-retry` 8.1.1, `plugin-throttling` 11.0.5 | as listed | | 19, 24.2 MB (most of it `.d.ts` types; `bottleneck` 0.9 MB) | 137.9 KB; import 7 ms (median of 5) | |
| `@octokit/rest` | 22.0.1 (2025-10-31) | 4 (core, request-log, paginate-rest ^14, rest-endpoint-methods ^17) | 18, 18.2 MB | not built | 666; 2026-10-20; 65 |
| `octokit` (all in one) | 5.0.5 (2025-10-31) | 11 (app, oauth-app, webhooks among them) | 39, 90.7 MB | not built | 7,862; 2026-10-20; 54 |
| `@octokit/request` | 10.0.16 (2026-08-30) | 6 | 8, 6.1 MB | not built | 265; 2026-10-20; 17 |

- Every Octokit package states `engines: { node: ">= 20" }` and no Bun support. The probes below ran on Bun 1.4.0.
- `@octokit/rest` 22.0.1 pins older majors of two plugins than the latest (paginate-rest ^14 against 16.0.0; rest-endpoint-methods ^17 against 18.0.0).
- Sources: the registry and `gh api repos/octokit/...`, read 2026-10-20; the installs and builds.

### 3.2 What Octokit gives that `gh.ts` builds by hand

| `gh.ts` builds | Octokit's part | Source |
|---|---|---|
| The `gh api` command line, headers and environment (`ghCall`, `headers`, `ghEnv`) | `octokit.rest.<group>.<method>({ owner, repo, ... })`: typed endpoints, path parameters encoded by `@octokit/endpoint` | `plugin-rest-endpoint-methods` |
| The status from GitHub's body or gh's stderr line (`statusOf`, `httpErrorLine`) | `RequestError` with `status`, `response.headers` and `response.data` | `@octokit/request-error` |
| The missing scope from gh's second stderr line (`missingScopeOf`) | Nothing built in. The response headers `x-oauth-scopes` and `x-accepted-oauth-scopes` are on `error.response.headers`; a compare is still ours | note 09, section 1.4 |
| `X-GitHub-Api-Version: 2026-03-10` on every call | Not sent by default (`grep` of core, request and endpoint finds no version header). A per-call `headers` entry worked (probe: `x-github-api-version-selected: 2026-03-10`); a `hook.before("request")` could add it to every call | probe |
| The retry of an unexpected 404 or 409 after a create, never for a POST (`triesAgainAfter`) | `plugin-retry` retries "server 4xx/5xx responses except `400`, `401`, `403`, `404`, `410`, `422`, and `451`", 3 times, waiting `(retryCount + 1)²` seconds. It checks no method, so it retries a POST on a 5xx. The spec's rule stays custom, or needs per-call `request: { retries }` | plugin-retry README; `dist-bundle/index.js`, lines 12-15 and 57-59 |
| Rate limits: an outside failure, exit 3 (`rateLimited`) | `plugin-throttling` "Implements all recommended best practices ... to prevent hitting secondary rate limits": writes one at a time at least 1 s apart, writes that notify at least 3 s apart, search 2 s, at most 10 at once; on a limit it calls `onRateLimit` or `onSecondaryRateLimit` with `retry-after`, and both handlers are required | plugin-throttling README; `dist-bundle/index.js`, lines 88-118 and 192-203 |
| One page of 100 (`per_page=100` in settings, pull-request and runs) | `octokit.paginate(...)` follows the `Link` header | plugin-paginate-rest |
| Body checks with zod (`readBody`) | TypeScript types from GitHub's OpenAPI description (`@octokit/openapi-types` 29.0.1, from description release 23.0.1). Types only: no check at run time. Which REST API version the types describe: UNVERIFIED | `@octokit/openapi-types` `package.json` and README |
| Redaction (`redact.ts` at the command's edge) | `RequestError` replaces the `authorization` header's value with `[REDACTED]`, and `client_secret=` and `access_token=` in the URL | `@octokit/request-error` `dist-src/index.js`, lines 27-35 |

### 3.3 How Octokit gets a token: three ways

| Way | What changes |
|---|---|
| **1. `gh auth token`**, passed as `auth` | acmelabs holds the token. This reverses ADR-0014 and the spec's "Never: read or print a token: no `gh auth token`". `redact.ts` finds secrets by the names of the World's environment variables (`TOKEN`, `SECRET`, `KEY`, `PASSWORD`), so a token from `gh auth token` is not in its list; and its header rule matches `Bearer`, while gh's tokens go as `token <value>`. gh is still needed on a maintainer's machine, for the token |
| **2. `GH_TOKEN` or `GITHUB_TOKEN`** from the environment | The token is in the World's environment, so `redact.ts` covers it. A maintainer's keyring login (this machine's case, note 09, section 1.9) has no such variable, so way 1 is still needed there |
| **3. A fetch that runs `gh api -i`**, passed as `request.fetch` | gh adds its own token, so acmelabs never holds one, and ADR-0014 holds. Each call still starts one gh program (about 0.3 s), under the World's limits. Probed in 3.4 |

### 3.4 Probes on Bun 1.4.0

All GET. No token was printed or passed by the probe; way 3 used gh's own login.

| Call | Fetch | Result |
|---|---|---|
| `rest.repos.get` of `acmelabs-15/brain`, no token | global `fetch` | 200 in 241 ms; `x-github-api-version-selected: 2026-03-10` |
| the same | the repo's `realWorld().fetch` | 200 in 53 ms |
| the same, with `timeoutMs: 1` | `realWorld().fetch` | `RequestError`, **status 500**, message = the World's "got no whole answer within 1 millisecond and was stopped", `cause` = the World's `CommandError` (kind `outside`). It took **14,050 ms**: plugin-retry retried the 500 three times, 1 + 4 + 9 s |
| scripted 200 | `fakeWorld().fetch` | 200 in 20 ms; the call is in `world.calls` |
| scripted 404 | `fakeWorld().fetch` | `RequestError`, status 404 |
| scripted `limit: "time"` | `fakeWorld().fetch` | `RequestError`, status 500. plugin-retry retried it; `world.calls` holds 4 fetches; it took 17 s of real time, because Bottleneck's waits are real timers, not `World.sleep` |
| `rest.repos.get` | **way 3**: a 25-line fetch that runs `gh api -i` through `realWorld().spawn` | 200 in 391 ms; `x-ratelimit-limit: 5000`, so gh's login was used |
| `rest.users.getAuthenticated` | way 3 | 282 ms; login `loriensleafs` |
| `rest.repos.get` of a repo that does not exist | way 3 | `RequestError`, status 404, "Not Found - https://docs.github.com/rest/repos/repos#get-a-repository" |
| `paginate(rest.repos.listTags, { per_page: 2 })` | way 3 | 6 tags of brain in 3 gh calls, 924 ms |

- **gh's `-i` output** ends its status line with LF, and each header with CRLF: `HTTP/2.0 200 OK\n`, then `Access-Control-Allow-Origin: *\r\n` (probe with `od -c`). Note 09, section 1.2 says "each ending in CRLF" for the headers.
- The way-3 fetch in the probe handles no gh failure outside HTTP (gh not installed, exit 4 with no login, a network failure). A real one needs those, as `callOnce` in `gh.ts` has them.

### 3.5 Under the World's limits and `fakeWorld`

- **Requests:** `request.fetch` takes `World.fetch` and `fakeWorld().fetch` (probed). So the World's time and body limits apply to each request, and `world.calls` logs each one. "You can pass a custom `fetch` function using the `options.request.fetch` option" (https://github.com/octokit/request.js).
- **A limit's failure changes form:** Octokit wraps any error from fetch as `RequestError` with status 500 and the error as `cause`; only an `AbortError` "is bubbled up to the caller" (request.js README). So a time limit would look like a GitHub 500 to code that reads `status`, unless the failure table reads `cause` first.
- **Waits outside the World:** plugin-retry and plugin-throttling wait through Bottleneck's timers. `World.sleep` and `fakeWorld`'s clock do not see them. A test with retry on waits for real (17 s above), so tests turn retry and throttling off, or the code does not use them.
- **Cancel:** `request.signal` takes an `AbortSignal` (request.js README); the World passes the run's signal to `fetch` already.
- **Way 3 in tests:** `fakeWorld` would script each `gh api -i ...` command line with a status line, headers and a body, in place of today's JSON stdout. The 8 test files of `packages/cli/src/github/__tests__/` (3,875 lines, with the 139-line `gh-answers.ts`) script today's form.

### 3.6 Other clients

| Package | Version (date) | What it is | Fit |
|---|---|---|---|
| `@kud/gh` | 0.21.0 (2026-10-05); first published 2026-07-15 | "Shells out to the `gh` CLI and returns plain data": `ghRest`, `ghGraphql`; depends on execa 9.6.1 | 0 stars; starts gh outside the World; `engines` node 22 |
| `@timmo001/effect-gh` (JSR) | not read | "An Effect v4 SDK for the GitHub CLI (`gh`)"; `Api.json(request, schema)`; takes a `ChildProcessSpawner` | Needs Effect v4 for every call (note 11, section 1.3) |
| `gh-axi` | 0.1.43 (2026-10-18) | A gh wrapper CLI for agents, TOON output | A CLI, not a library |

Sources: https://www.npmjs.com/package/@kud/gh · https://jsr.io/@timmo001/effect-gh · https://www.npmjs.com/package/gh-axi (Exa, 2026-10-20).

## 4. What each choice replaces

Code lines exclude comments and blank lines, counted on 2026-10-20 on branch `github-ops` at `3106b45`.

### 4.1 File by file

| File (code lines) | Octokit, way 3 (gh api fetch) | Octokit, way 1 or 2 (token) | A git library | Stays custom in every case |
|---|---|---|---|---|
| `gh.ts` (233) | The command line, headers, environment, JSON and status parsing: about 95 lines. A fetch over `gh api -i` with gh's failures adds about 40 to 60 | The same 95 lines, and gh is no longer started per call. Adds the token read and redaction for it | — | The failure table (`failureFor`, `answerOrThrow`, about 60 lines), the 404/409 retry rule, `repoPath`'s name checks, the missing-scope compare (from headers in place of stderr) |
| `git.ts` (27) | — | — | simple-git, isomorphic-git, es-git or `@napi-rs/simple-git` replace the command line and its exit-code reading: a few lines. Each one is immune to the variables (2.2) | The sha check; the reading of "unknown" as "no" |
| planned `push.ts` (not written; the spec's steps suggest about 80 to 120 lines) | — | — | A library's push and `ls-remote`; libgit2 and isomorphic-git need the token (2.3); simple-git needs `allowUnsafeCredentialHelper` | `origin` check and add, "skipped when at the local commit", no force, the failure kinds |
| `login.ts` (99) | — (Octokit does not read gh's login) | `GET /user` and the `x-oauth-scopes` header could replace `gh auth status --json` | — | The scope rules (`includedScopes`), the fix command lines |
| `repo.ts` (103) | Calls become `rest.repos.get`, `rest.repos.createInOrg`, `rest.git.getRef`; zod bodies (about 10 lines) could go if the types are trusted | as way 3 | `inLocalHistory` through the library | The re-run rule: visibility, empty repo (409), local history, exit 2 for other work |
| `settings.ts` (155) | Calls become `rest.actions.*` and `rest.repos.*Ruleset*`; zod bodies (about 45 lines) could go | as way 3 | — | `actionsSetting`, `protectMain`, the compare, "two named Protect main" |
| `pull-request.ts` (106) | Calls become `rest.pulls.list` and `rest.pulls.create`; zod bodies (about 15 lines) could go | as way 3 | — | Branch checks, head and base match, the 422 race |
| `runs.ts` (171) | Calls become `rest.actions.listWorkflowRunsForRepo`, `getWorkflowRun`, `rest.git.getRef`, `getTag`; zod bodies (about 20 lines) could go | as way 3 | — | Polling, deadlines, newest run, status messages, the tag peel |
| `names.ts` (13) | — | — | — | All of it |
| Total (907) | about 100 to 190 fewer, by the estimates above | about 150 to 190 fewer, with the token work added | under 50 fewer | about 600 |

- The zod bodies are a choice, not a saving for free: today a body of another shape is an outside failure, exit 3, with the field that is wrong. With types only, a changed field is `undefined` at run time, and the step reads it as a value.
- All numbers in this table are estimates from reading the code: no option was built.

### 4.2 Candidate by candidate

| Candidate | Gains | Loses or reverses |
|---|---|---|
| **Octokit, way 3** (core and four plugins over a `gh api -i` fetch) | Typed endpoints; `RequestError` with status and headers; paging; rate-limit handling; a maintained client (core pushed 2026-10-20) | 19 packages, 138 KB bundled; gh still starts per call; Octokit's retry and throttling waits bypass `World.sleep` and the fake clock (off in tests, or not used); plugin-retry retries a POST on a 5xx unless told not to; every test's scripted answer changes form; no Bun claim (probed works) |
| **Octokit, way 1** (`gh auth token`) | As way 3, plus requests through `World.fetch` (53 ms against about 300 ms), `fakeWorld`'s fetch as the seam | Reverses ADR-0014 and the spec's "no `gh auth token`"; `redact.ts` misses the token; a World limit becomes a `RequestError` 500 that plugin-retry retries |
| **simple-git 4.0.2** for git | Removes the GIT_ variables by default; a maintained, widely used wrapper | It starts git with `node:child_process`: no World limits, no process group, no `fakeWorld` log (note 11 found the same); exit 1 with no stderr reads as success; gh's helper needs an "unsafe" flag; `GIT_TERMINAL_PROMPT` needs `allowEnvironment`, and `.env()` with any guarded name throws (probe: the shell's `GIT_EDITOR` made it throw); 7 packages |
| **isomorphic-git 1.44.3** for git | Immune to the variables; pure JavaScript, no binary; its http client can be `World.fetch` (probed, GET) | The token in acmelabs for push (ADR-0014); 55 packages, 9.1 MB; no user git config; local work runs in-process with no limit; tests need real repos |
| **es-git 0.7.0 or `@napi-rs/simple-git` 1.2.0** for git | Immune when opened by path; fast after load (11-13 ms); prebuilt binaries | The token in acmelabs for push (ADR-0014); a native binary per platform, 5.6 to 5.9 MB; es-git's latest stable is from 2026-05-17, with 8 `0.7.0-next` builds since (the last on 2026-10-12); `@napi-rs/simple-git` pushes with credentials only synchronously; tests need real repos |
| **dugite 3.2.3** | — | Passes the environment through (the `GIT_DIR` case failed); 158 MB; it runs a postinstall download |
| **nodegit** | — | Fails to install (0.27.0) or to load on Bun 1.4.0 (0.28.0-alpha.38) |
| **No package; remove the GIT_ variables in `git.ts` or in the World** | Fixes the cause for every git call; keeps ADR-0014, the World's limits and `fakeWorld`; matches git, pre-commit and simple-git (section 1.5) | A World change (`SpawnOptions.env` cannot remove a variable); a change to ADR-0015's "no variable is removed"; a user's own GIT_ settings no longer reach acmelabs's git, unless allowed by name |

### 4.3 What stays custom in every case

- **The read-before-write rule** of each step, and the skipped report when the result is there.
- **The re-run rule** of `ensureRepo`: reuse only an empty repo or one whose main commit is in the local history, with the asked visibility; exit 2 for any other.
- **Protect main** and **the Actions setting**: the bodies, and the compare before a write.
- **The PR reuse**: the head and base match, and the 422 "already exists" race.
- **The workflow run wait**: the 10-second poll, the 2-minute and 30-minute deadlines, the newest run, the status messages, and the conclusion returned.
- **The tag peel**: annotated tags to their commit.
- **The failure-kind table**: GitHub's answers to exit codes 1, 2, 3 and 4 (ADR-0007).
- **The name checks** for owner, repo, branch, sha and tag.
- **`checkLogin`** through `gh auth status --json`, and the scope rules.
- **`fakeWorld`** as the test seam, and the World's limits.
- **The git variable rule** for any git program that acmelabs still starts (section 1).

## Gaps

| Open point | The probe or source that would settle it |
|---|---|
| Push and clone with isomorphic-git, es-git or `@napi-rs/simple-git` against GitHub, with a token from gh | Needs a scratch repo that acmelabs may push to: a GitHub write, so Peter's permission first |
| Whether an `AbortSignal` stops es-git or `@napi-rs/simple-git` inside a slow network call | Clone from a local `Bun.serve` server that sends 1 byte a second; abort at 200 ms; time the reject |
| Whether simple-git's abort or block timeout stops git's own children (`git-remote-https`, the credential helper) | A `ls-remote` against a slow local server through simple-git; abort; list the children with `pgrep` |
| Whether simple-git's `errors` option can tell exit 1 from exit 0 for `merge-base --is-ancestor` | A custom `errors(error, result)` that throws on `result.exitCode === 1`; run both cases |
| Which libgit2 version es-git 0.7.0 and `@napi-rs/simple-git` 1.2.0 bundle, and why `fromEnv` opened B under `GIT_COMMON_DIR` against libgit2's docs | Read each repo's `Cargo.lock` for `libgit2-sys`; compare with libgit2's changelog |
| Whether isomorphic-git reads `~/.gitconfig` in any command | Set `url.<x>.insteadOf` in a probe `HOME`; run `getRemoteInfo`; see which URL it fetches |
| Which REST API version `@octokit/openapi-types` 29.0.1 describes | Read github/rest-api-description release v23.0.1: which description file Octokit's `download.js` takes |
| Whether `GIT_SSL_CAINFO` or the proxy variables matter to ACMElabs's maintainers | Ask the maintainers, or read their shell setup; it decides the allowlist |
| The dates of the bug reports in section 1.6, apart from worktrunk's | `gh api repos/<owner>/<repo>/issues/<n>` for each, reading `created_at` |
| Whether `GIT_REFERENCE_BACKEND` and `GIT_REF_STORAGE_FORMAT` belong in git's `local_repo_env[]` | A report to the git mailing list (git@vger.kernel.org); an outward-facing step, so Peter's call |
| The planned `push.ts` size, for the savings in section 4 | Write task 11, then count |
| Glossary: `CONTEXT.md` has no word for git's local variables, the GIT_ variables, or a git hook | Raise them through the domain-modeling skill |
| This note has no row in `docs/research/README.md` yet: the research agent changed no other file | Add the row: "How do we stop git's variables from moving acmelabs's git calls, and which git and GitHub packages would cut custom code?", 2026-10-20 |
