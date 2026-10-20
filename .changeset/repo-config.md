---
"@acmelabs/cli": minor
---

A repo now declares its repo kinds and hosts in `acmelabs.json`. `readRepoConfig` reads and checks the file, and a `RepoConfigError` names the file and each bad field.
