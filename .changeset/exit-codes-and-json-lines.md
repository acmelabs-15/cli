---
"@acmelabs/cli": minor
---

Every `acmelabs` command ends with an exit code that tells a script what happened: 0 done, 1 problem found, 2 bad input or config, 3 an outside tool or service failed, 4 a login is needed, 70 a bug in acmelabs, 130 cancelled by the user. In JSON mode, a command prints one JSON line per progress update, then the result line last, so a script that wants only the answer reads the last line. The first commands arrive with the `repo-checks` module.
