---
"@acmelabs/cli": patch
---

`acmelabs.json` keeps the layout that the format check gives it. A repo kind too long for one line of 100 columns now spans several lines, as oxfmt with the ACMElabs format preset writes it, so formatting the repo leaves the file unchanged.
