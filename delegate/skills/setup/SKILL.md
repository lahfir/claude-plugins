---
description: Detect which delegation harnesses this machine has, ask which harnesses and models to allow, and write the allowlist. Run once per machine, and again after you install or remove a CLI.
disable-model-invocation: true
allowed-tools: Bash, AskUserQuestion, Read
---

# Build the delegation allowlist

The allowlist is the user's policy: the ceiling of what `/delegate:route` may ever pick.
Detection is the floor. Do not decide the policy for them. Ask.

## 1. Detect

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" detect
```

Read the JSON. It gives you, for every harness: `available`, `always_present`, the
harness `traits`, and every model with its `key` and its `fits` line. It also reports
`typesafe_key` and where the allowlist will be written.

## 2. Ask

Use AskUserQuestion. Its limits shape the flow: 4 questions per call, 4 options per
question, and `multiSelect: true` for a list.

- **Never ask about a harness whose `available` is false.** Say in your summary which
  ones you skipped and what installs them.
- `inline` and `subagent` are `always_present`. Offer them; do not force them.
- First question: which harnesses to allow, `multiSelect: true`. Put the available
  outside CLIs and `subagent` in it. Use each harness's `traits` as the option
  description, shortened.
- Then one `multiSelect` question per chosen harness: which of its models to allow.
  Use each model's `fits` as the description. More than four chosen harnesses needs a
  second AskUserQuestion call; that is fine.
- Always include `inline:this-session` in the final list unless the user removes it.
  Without it, route can never answer "keep this one yourself".

## 3. Save

Pass the chosen keys as one JSON array:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" save '["inline:this-session","subagent:sonnet","codex:gpt-6-astra"]'
```

The command rejects any key that is not in the catalog, so a typo fails loudly. It
prints the path it wrote.

## 4. Report

Tell the user, in this order:

1. The path of the allowlist file, and that it is plain JSON they can edit.
2. Which harnesses you skipped because the CLI is missing.
3. If `typesafe_key` is false: `TYPESAFE_API_KEY` is unset, so route will return the
   roster and ask the model to choose instead of returning a probability. Setting the
   key turns the judgement on. Get one at https://typesafe.ai.

## Adding a model the catalog does not have

The bundled catalog ships a curated set. Add more in `~/.claude/delegate-catalog.json`,
which a plugin update never touches. `detect` reports its path as `catalog_overlay`.

Give it the same shape as `${CLAUDE_PLUGIN_ROOT}/catalog.json`. A harness id that is
already there gains the models you list; a new id becomes a new harness, and needs
`bin`, `traits`, and `launch` as well.

```json
{
  "harnesses": [
    { "id": "devin", "models": [{ "id": "claude-sonnet-5-high", "fits": "..." }] }
  ]
}
```

Get the exact id from the harness's own list command (`devin models list`,
`opencode models`). The `fits` line is the whole rubric TypeSafe judges against, so
write what the model should get **and** what it must never get. Then rerun this skill.
