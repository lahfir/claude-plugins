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

`catalog.json` carries every harness and model with a line on what it is good at and
what it is bad at. Those lines are the whole rubric, so they are written to be honest
about weaknesses. Six harnesses ship: `inline`, `subagent`, `codex`, `cursor-agent`,
`opencode`, and `devin`. No Fable-class model is in the catalog, and a test enforces
that.

Add your own in `~/.claude/delegate-catalog.json`, which a plugin update never
touches. Same shape as `catalog.json`; a harness id that already exists gains the
models you list. Get the exact id from the harness's own list command
(`devin models list`, `opencode models`), then write its `fits` line. Set
`DELEGATE_CATALOG` to put the overlay somewhere else.

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
