---
"@acmelabs/cli": minor
---

Editors can now check `acmelabs.json` against a JSON schema shipped in the package, `schema/acmelabs.schema.json`. Point the file's `$schema` line at it to see a wrong host id, a missing repo kind or a repeated entry before any command runs.
