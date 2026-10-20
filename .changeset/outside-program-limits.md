---
"@acmelabs/cli": minor
---

Every outside program that a command runs now has a time limit: 5 minutes, unless the command sets another for that call. At the limit, or when the user cancels, acmelabs stops the program and every program it started, so a hung program, or a child it left behind, no longer keeps the command waiting. A time limit ends the command with exit 3 and a message that names the program and the limit, such as `gh api ... ran longer than 5 minutes and was stopped`. A program still gets the whole environment, plus any variables the command adds for that call.
