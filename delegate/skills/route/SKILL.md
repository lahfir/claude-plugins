---
description: Pick who runs a task - this session, a sub-agent, or an outside CLI such as codex, cursor-agent, opencode, or devin. Use when the user asks to delegate a task, asks which model or harness should do it, asks for a second opinion or an outside review, or asks whether a sub-agent should take it. Do not use for a task the user simply asked you to do.
allowed-tools: Bash, Read
---

# Route a task

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" route "<the task, in one or two sentences>"
```

Write the task as the work itself, not as a request. "Validate the three findings in
report.md against their cited lines" routes well. "Help me with the review" does not.
Name whether files must change, because an option that cannot write cannot take a
task that writes.

## Read the result

`mode` is `picked` or `manual`.

**`picked`** carries `pick`, `harness`, `model`, `launch`, `confidence`, `threshold`,
`below_threshold`, and the full `probabilities` map.

- `below_threshold: true` means the options were close. That is not a pick. Show the
  user the top two with their probabilities and let them choose.
- `dropped_unavailable` lists allowlisted entries whose CLI is not on this machine
  right now. `dropped_unknown` lists keys the catalog no longer has. Mention either
  one only if it is not empty; `dropped_unknown` means the allowlist needs a rerun of
  `/delegate:setup`.

**`manual`** means `TYPESAFE_API_KEY` is unset. The `candidates` array carries every
reachable entry with its `rubric`. Choose from it yourself, say that you chose it
without the model, and say once that setting the key turns the judgement on.

An error that says `no allowlist` means the machine is not set up. Tell the user to
run `/delegate:setup`.

## Launch it

Each entry carries a `launch` hint: the Agent tool for `subagent`, a command shape for
an outside CLI, and "do it here" for `inline`. The hint is the minimum correct shape,
not the full procedure.

**Before you start an outside CLI, read the `outside-harness-cli` skill if it is
installed.** It carries the rules that keep a run safe: background only, one writer
per file, no gates inside the run, stop by pid, and how to tell a live run from a dead
one. Without those rules an outside run collides with your own work.

Report the pick and its confidence to the user before you launch anything. Routing is
advice; starting a run is an action they should see coming.
