#!/usr/bin/env node
/**
 * Routing quality. Asks the live TypeSafe model to route a fixed set of tasks and
 * reports how often the pick lands in the acceptable set.
 *
 *   TYPESAFE_API_KEY=... node scripts/routing-cases.mjs
 *
 * This is the layer `claude plugin eval` cannot see. An eval run gets a throwaway
 * home and no TYPESAFE_API_KEY, so it grades whether Claude reaches for the skill;
 * this grades whether the catalog's rubric text produces the right answer. Every
 * case runs against the whole catalog, not against your allowlist, so the expected
 * answers are the same on every machine. Edit a `fits` line, rerun this.
 *
 * Each case allows a set, not one key: a read-only review is fine at codex or at
 * the cheap long-context reviewer, and a case that insists on one of them is
 * measuring the model's taste rather than the routing decision.
 */
import { buildRequest, entries, loadCatalog, readAnswer } from "./delegate.mjs";

const CASES = [
  {
    task: "Rename the field 'userId' to 'accountId' in the 40 files that reference it. The list of files is already known.",
    expect: ["subagent:haiku", "cursor-agent:composer-2.5"],
    why: "mechanical, already decided",
  },
  {
    task: "Read the diff on this branch and tell me honestly whether the new retry loop can lose a message. Change nothing.",
    expect: ["codex:gpt-6-astra", "opencode:openrouter/google/gemini-3.8-flash"],
    why: "read-only adversarial review",
  },
  {
    task: "Implement the three sub-tasks in plan.md: add the new endpoint, wire it to the store, and make the gate pass.",
    expect: ["cursor-agent:cursor-grok-4.6-high-fast", "cursor-agent:cursor-grok-4.6-high"],
    why: "must write files and run the gate",
  },
  {
    task: "The user just asked a one-sentence question about which of two variable names is clearer in the file we are both looking at.",
    expect: ["inline:this-session"],
    why: "a handoff costs more than the work",
  },
  {
    task: "Search the whole repository for every place that still constructs a raw SQL string, and report the list with line numbers.",
    expect: ["subagent:sonnet", "subagent:haiku"],
    why: "wide read, fresh context, no verdict",
  },
  {
    task: "Finding 4 in report.md claims the lock is released twice. Open the cited lines and decide whether the claim is true.",
    expect: ["subagent:opus", "codex:gpt-6-astra"],
    why: "decides whether a claim is true",
  },
  {
    task: "Audit this repository against the house conventions written in its own CLAUDE.md and AGENTS.md, and report every violation.",
    expect: ["devin:gpt-6-astra-medium"],
    why: "needs the repository's own rules loaded",
  },
  {
    task: "Change one string literal in config.ts from 'staging' to 'production'. Nothing else.",
    expect: ["inline:this-session", "cursor-agent:composer-2.5", "subagent:haiku"],
    why: "one-line edit",
  },
];

const ask = async (task, candidates) => {
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildRequest(task, candidates)),
  });
  if (!res.ok) throw new Error(`typesafe ${res.status} ${res.statusText}`);
  const a = readAnswer(await res.json());
  if (a.error) throw new Error(a.error);
  return a;
};

if (!process.env.TYPESAFE_API_KEY) {
  console.error("TYPESAFE_API_KEY unset -- this probe calls the live API and costs money");
  process.exit(2);
}

const candidates = entries(loadCatalog());
const results = await Promise.all(CASES.map((c) => ask(c.task, candidates).then((a) => ({ ...c, ...a }))));

let hits = 0;
let weak = 0;
for (const r of results) {
  const hit = r.expect.includes(r.key);
  if (hit) hits += 1;
  if (r.confidence < 0.55) weak += 1;
  console.log(
    `${hit ? "ok  " : "MISS"} ${r.confidence.toFixed(2)}  ${r.key.padEnd(38)} ${r.why}` +
      (hit ? "" : `\n       wanted one of: ${r.expect.join(", ")}\n       task: ${r.task}`),
  );
}
console.log(`\n${hits}/${CASES.length} in the acceptable set, ${weak} below the confidence threshold`);
process.exit(hits === CASES.length ? 0 : 1);
