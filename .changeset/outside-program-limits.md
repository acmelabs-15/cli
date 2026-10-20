---
"@acmelabs/cli": minor
---

Every outside program that a command runs now has a time limit and an output limit: 5 minutes, and 10 MB on stdout and on stderr each, unless the command sets others for that call. At a limit, or when the user cancels, acmelabs stops the program and every program it started, so a hung program, a flood of output, or a child it left behind no longer keeps the command waiting or fills memory. A limit ends the command with exit 3 and a message that names the program and the limit, such as `gh api ... ran longer than 5 minutes and was stopped` or `gh api ... printed more than 10 MB on stdout and was stopped`. A program still gets the whole environment, plus any variables the command adds for that call.
