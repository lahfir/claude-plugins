# delegate

Picks who runs a task: this session, a sub-agent, or an outside CLI.

Detection finds what the machine has. An allowlist you write holds what you permit.
[TypeSafe](https://typesafe.ai) judges which permitted option fits the task and
returns a probability for every option, so a close call shows up as a close call
instead of a confident wrong answer.

## Install

```bash
claude --plugin-dir ./delegate      # try it
```

Needs Node 18 or later, which Claude Code already requires.

## Use

```
/delegate:setup              once per machine, and after you install or remove a CLI
/delegate:route <task>       ask who should run it
```

`setup` writes `~/.claude/delegate-allowlist.json`. It is plain JSON; edit it freely.
Set `DELEGATE_ALLOWLIST` to put it somewhere else, for example one per project.

Set `TYPESAFE_API_KEY` to turn the judgement on. Without it `route` returns the roster
with each option's rubric and the model chooses by reading, which still works but
returns no probability.

## What it knows

Knowledge splits by scale. opencode lists 959 models, devin 392, cursor-agent 227, so
no bundled file can describe them.

| Layer | Holds | Lives in |
|---|---|---|
| Harness | `traits`, `bin`, default `launch`, the `list` command | `catalog.json` (bundled) |
| Model | the `fits` line, optional `launch` override | your allowlist |

**22 harnesses ship.** Two are internal (`inline`, `subagent`); the rest are outside
CLIs. `catalog.json` also carries a few **suggested** models per harness to seed a
setup. They are a seed, not a roster — setup reads the real list from the harness.

| `verified` | Harnesses |
|---|---|
| `local` — the launch line was confirmed first-hand here | `inline`, `subagent`, `codex`, `cursor-agent`, `opencode`, `devin`, `gemini`, `cline`, `muse`, `openclaw`, `command-code` |
| `docs` — from documentation, never run here | `aider`, `goose`, `amp`, `crush`, `qwen`, `kilocode`, `roo`, `copilot`, `droid`, `cn`, `openhands` |

A `docs` entry's first run is also its first test, and the failure lands in your
terminal. Setup says which before you allowlist one.

Not every harness is a coding agent, and that is the point. `openclaw` has no file
tools at all, so it gives a text-only second opinion that cannot touch your tree.
`codex` and `droid` are read-only by default. `muse` keeps an OS sandbox on while
running headless, and `muse exec --disable-write` makes a whole run read-only.

At route time the rubric is the harness's `traits` plus the entry's own `fits`, so a
catalog update still reaches every entry you already allowlisted.

**`fits` decides routing quality.** It must say what the model should get *and* what
it must not get. A line with only praise makes that option win everything.

**Per-model launch config** goes in the entry's optional `launch`, which replaces the
harness template for that entry and still substitutes `{model}`:

```
OPENCODE_CONFIG_CONTENT='{"provider":{"openrouter":{"models":{...}}}}' opencode run -m {model} --format json "<prompt>"
```

To add a whole **harness** the catalog does not ship, use the overlay at
`~/.claude/delegate-catalog.json`, which a plugin update never touches. Adding a
**model** needs no overlay — rerun setup, or edit the allowlist.

## Check

Three layers, because each one sees something the others cannot.

**1. The plumbing.** Free, fast, no network.

```bash
node scripts/delegate.test.mjs
```

Catalog overlay merge, `save` rejecting an unknown key, the request shape, the
allowlist holding keys and not a rubric snapshot, and no Fable model in the catalog.

**2. Routing quality.** Calls the live API, so it costs money.

```bash
TYPESAFE_API_KEY=... node scripts/routing-cases.mjs
```

Eight tasks with a known-good answer set, judged against the whole catalog rather
than your allowlist, so the expected answers hold on every machine. This is what
tells you a `fits` line you edited made routing better or worse. Last run: 8/8, all
above the confidence threshold.

**3. Whether Claude reaches for the skill.** Costs money, needs Claude Code 2.1.269
or later.

```bash
claude plugin eval . --trust-plugin --allow-tools Bash --no-publish --max-cost-usd 20
```

Three cases under `evals/`: two that must fire `/delegate:route` on natural phrasing,
and one ordinary coding question that must not. That last one matters most, because a
router that fires on everything is worse than no router.

An eval run gets a throwaway home and withholds `TYPESAFE_API_KEY` and
`DELEGATE_ALLOWLIST`, so `route` always hits the not-set-up path inside a run. The
cases grade the trigger and how that state is reported, and layer 2 grades the pick.

Last run, 3 cases, 3 runs, one arm, no Bash grant, $1.61:

| Case | Trigger | Rubric |
|---|---|---|
| `routes-second-opinion` | fired 3/3 | 0/3 |
| `routes-subagent-or-inline` | fired 3/3 | 2/3 |
| `ignores-ordinary-task` | stayed away 3/3 | 3/3 |

The trigger is 9/9. The rubric misses come from the missing Bash grant, not from the
plugin: the skill runs its script through Bash, so without that grant Claude reports
that it cannot execute the router. The rubrics have no branch for that state, and
they should not gain one, because a granted run never reaches it.

**Grant Bash to score the rubrics.** `--allow-tools Bash` puts every command under
Claude Code's OS sandbox. That sandbox refuses to start when a credential store it
must hide holds a symbolic link inside it, `~/.docker` among them. Keep such a store
in one plain directory; its root may itself be a link.

## Ideas that did not ship

One TypeSafe question, not several. A second question about write access would not
change what code does, because the write rule is already in each option's rubric.
No retry or backoff: a probe that hits a rate limit is rerun by hand.
