# Triage labels

Adapted from mattpocock/skills, MIT, commit c55ee46.

The triage skill speaks in five canonical roles. This file maps each role to the label string this repo's tracker uses. The triage skill creates a label in the tracker the first time it applies one that does not exist yet.

| Role | Label in this tracker | Meaning |
|---|---|---|
| `needs-triage` | `needs-triage` | The maintainer has not evaluated this issue yet |
| `needs-info` | `needs-info` | Waiting on the reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for an agent to build without a human present |
| `ready-for-human` | `ready-for-human` | Needs a human to implement |
| `wontfix` | `wontfix` | Will not be actioned |

When a skill names a role, use the label string from the middle column. Edit that column to match the vocabulary this repo already uses.
