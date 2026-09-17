---
description: Detect which delegation harnesses this machine has, ask which harnesses and models to allow, and write the allowlist. Run once per machine, and again after you install or remove a CLI.
disable-model-invocation: true
allowed-tools: Bash, AskUserQuestion, Read
---

# Build the delegation allowlist

The allowlist is the user's policy: the ceiling of what `/delegate:route` may ever
pick. Detection is the floor. Do not decide the policy for them. Ask.

Model rosters are large. opencode lists 959 models, devin 392, cursor-agent 227. So
the harness's own `list` command is the source of truth, and the catalog's
`suggested` array is only a seed. Never present a picker with hundreds of options.

## 1. Detect

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" detect
```

For every harness this gives `available`, `always_present`, `traits`, its `list`
command, and a short `suggested` array. It also reports `typesafe_key` and where the
allowlist will be written.

## 2. Ask which harnesses, with AskUserQuestion

One call, two questions. Both `multiSelect: true`.

- **Q1, outside CLIs.** Only those whose `available` is true. There are at most four,
  so they fit. Use each harness's `traits`, shortened, as the option description.
- **Q2, sub-agent models.** The three in `subagent.suggested`: haiku, sonnet, opus.
  This is a small fixed set, so a picker is the right tool here.

`inline` is always included. Do not ask about it. Without it the router can never
answer "keep this one yourself".

Say in your summary which harnesses you skipped, and that the CLI is missing.

## 3. Choose models inside each outside CLI, in conversation

**Do not use AskUserQuestion for this.** Four options cannot cover 959 models.

For each outside CLI the user enabled, run its `list` command and read the real ids:

```bash
opencode models | head -40
devin models list
cursor-agent models
```

codex has no list command. Its model is set by policy; use `suggested`.

Then propose **at most eight** ids for that harness, in a short table with one line
each. Tell the user they can name any other id from the list instead. Take the whole
list into account, not only the head of it; grep it when you are after a family.

## 4. Write the `fits` line for every chosen model

`fits` is the entire rubric the router judges that option against, so it decides the
routing quality. Rules:

- Say what the model **should** get and what it **must not** get. A line with only
  praise makes the option win everything.
- Write plain judgement, not marketing, and keep it to one or two sentences.
- Do not describe the harness. The harness's own `traits` is added at route time, so
  repeating it wastes the rubric.
- Where the id matches a `suggested` entry, copy its `fits`.
- **If you do not know the model, say so and ask the user what it is good at.** Do
  not invent a description. A wrong rubric sends real work to the wrong model.
- Do not propose a Fable-class id. It costs far more than the delegated work is worth.

## 5. Per-model launch config

Some models need their own command. An opencode model routed through a named
provider is the common case:

```
OPENCODE_CONFIG_CONTENT='{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash":{"options":{"provider":{"order":["baseten/fp8","novita/fp8"],"allow_fallbacks":true}}}}}}}' opencode run -m {model} --format json "<prompt>" < /dev/null > events.jsonl 2> err.log
```

Put that whole string in the entry's optional `launch` field. It replaces the
harness template for that entry only, and `{model}` is still substituted. Ask the
user for it; do not invent a provider order.

Leave `launch` out when the harness default is right, which is most of the time.

## 6. Save

Pass one JSON array of entries. Each needs `harness`, `model`, and `fits`; `launch`
is optional.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" save '[
  {"harness":"inline","model":"this-session","fits":"Short work, or work needing context only this session holds."},
  {"harness":"subagent","model":"sonnet","fits":"A broad search across a repository. Not for deciding whether a contested finding is real."},
  {"harness":"codex","model":"gpt-6-astra","fits":"Adversarial review of code it did not write. It cannot implement anything."}
]'
```

It rejects an unknown harness, an empty `model`, and a missing `fits`, so a mistake
fails loudly.

## 7. Report

1. The allowlist path, and that it is plain JSON they can edit.
2. Which harnesses you skipped, and why.
3. If `typesafe_key` is false: `TYPESAFE_API_KEY` is unset, so route returns the
   roster and the model chooses by reading rather than by probability. Setting the
   key turns the judgement on. Get one at https://typesafe.ai.

## Adding a harness the catalog does not ship

The overlay at `~/.claude/delegate-catalog.json` survives a plugin update. Give it
the same shape as `${CLAUDE_PLUGIN_ROOT}/catalog.json`. A new harness id needs `bin`,
`traits`, `launch`, and `list`.

```json
{ "harnesses": [ { "id": "aider", "bin": "aider", "list": "aider --list-models",
  "traits": "An outside CLI that edits files in place.",
  "launch": "aider --model {model} --message \"<prompt>\"", "models": [] } ] }
```

To add a **model**, you do not need the overlay. Rerun this skill, or edit the
allowlist directly.
