import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allowlistPath, buildRequest, entries, loadCatalog, onPath, readAnswer, resolve } from "./delegate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "delegate.mjs");
const catalog = loadCatalog();
const all = entries(catalog);

// The one rule that must never regress, whatever else the catalog gains.
assert.ok(all.every((e) => !e.key.toLowerCase().includes("fable")), "no Fable model in the catalog");

// Every entry carries a launch hint and a rubric that names its harness.
for (const e of all) {
  assert.ok(e.launch, `${e.key} has no launch hint`);
  assert.ok(!e.launch.includes("{model}"), `${e.key} launch hint kept its placeholder`);
  assert.ok(e.rubric.startsWith(`Runs under ${e.harness}.`), `${e.key} rubric hides its harness`);
}
assert.ok(all.some((e) => e.key === "inline:this-session"), "inline is always a candidate");

// PATH lookup finds a real binary and misses a fake one.
assert.ok(onPath("node"));
assert.ok(!onPath("definitely-not-a-real-binary-xyz"));

// The request is one Choice whose options are exactly the candidates.
const req = buildRequest("rename a field across the repo", all);
assert.equal(req.model, "jev-latest");
assert.deepEqual(Object.keys(req.questions), ["pick"]);
assert.equal(req.questions.pick.type, "choice");
assert.deepEqual(Object.keys(req.questions.pick.criteria).sort(), all.map((e) => e.key).sort());
assert.deepEqual(Object.keys(req.state), ["task"]);

// Answer reading, both paths.
assert.equal(
  readAnswer({ answers: { pick: { type: "choice", choice: "subagent:haiku", confidence: 0.9, probabilities: {} } } }).key,
  "subagent:haiku",
);
assert.ok(readAnswer({ answers: {} }).error);

// save takes full entries: harness must be known, model and fits must be present.
const path = join(mkdtempSync(join(tmpdir(), "delegate-")), "allowlist.json");
const env = { ...process.env, DELEGATE_ALLOWLIST: path };
const OVERRIDE = "OPENCODE_CONFIG_CONTENT='{\"x\":1}' opencode run -m {model} \"<prompt>\"";
const good = JSON.stringify([
  { harness: "inline", model: "this-session", fits: "short work" },
  { harness: "subagent", model: "sonnet", fits: "a broad search" },
  { harness: "opencode", model: "openrouter/deepseek/deepseek-v4.1-flash", fits: "cheap long-context read", launch: OVERRIDE },
]);
execFileSync("node", [cli, "save", good], { env });
const saved = JSON.parse(readFileSync(path, "utf8"));
assert.equal(saved.entries.length, 3);
assert.equal(saved.confidence_threshold, catalog.confidence_threshold);
assert.equal(saved.entries[0].launch, undefined, "no launch key when none was given");
assert.equal(saved.entries[2].launch, OVERRIDE);

const rejects = [
  [JSON.stringify([{ harness: "nope", model: "m", fits: "f" }]), /unknown harness/],
  [JSON.stringify([{ harness: "subagent", model: "", fits: "f" }]), /model must be/],
  [JSON.stringify([{ harness: "subagent", model: "sonnet" }]), /fits must be/],
  [JSON.stringify([{ harness: "subagent", model: "sonnet", fits: "f", launch: 7 }]), /launch must be/],
  ["[]", /non-empty/],
];
for (const [payload, re] of rejects) {
  assert.throws(() => execFileSync("node", [cli, "save", payload], { env, stdio: "pipe" }), re, payload);
}

// resolve joins harness traits to the entry's own fits, and the override wins.
const r = resolve(catalog, JSON.parse(readFileSync(path, "utf8")));
assert.ok(r[1].rubric.startsWith("Runs under subagent."));
assert.ok(r[1].rubric.endsWith("a broad search"));
assert.equal(r[2].key, "opencode:openrouter/deepseek/deepseek-v4.1-flash");
assert.ok(r[2].launch.startsWith("OPENCODE_CONFIG_CONTENT="));
assert.ok(r[2].launch.includes("-m openrouter/deepseek/deepseek-v4.1-flash"), "{model} substituted in the override");
assert.ok(!r[2].launch.includes("{model}"));

// A harness the catalog lost is reported, not crashed on.
assert.equal(resolve(catalog, { entries: [{ harness: "gone", model: "m", fits: "f" }] })[0].known, false);

// The old keys-only file gives a clear instruction, not a TypeError.
assert.throws(() => resolve(catalog, { keys: ["subagent:sonnet"] }), /old keys format/);
assert.throws(() => resolve(catalog, {}), /no entries array/);

// route without a key reports the roster instead of guessing.
const manual = JSON.parse(
  execFileSync("node", [cli, "route", "add a test"], { env: { ...env, TYPESAFE_API_KEY: "" }, encoding: "utf8" }),
);
assert.equal(manual.mode, "manual");
// Machine-independent: inline and subagent always reach; opencode only if installed.
const keys = manual.candidates.map((c) => c.key);
assert.ok(keys.includes("inline:this-session") && keys.includes("subagent:sonnet"));
assert.equal(keys.length, onPath("opencode") ? 3 : 2);

// The overlay's job is adding a whole harness the catalog does not ship.
const overlay = join(mkdtempSync(join(tmpdir(), "delegate-ov-")), "catalog.json");
writeFileSync(
  overlay,
  JSON.stringify({
    harnesses: [
      { id: "subagent", models: [{ id: "custom", fits: "a model the user added" }] },
      { id: "aider", bin: "aider", traits: "An outside CLI.", launch: "aider --model {model}", models: [{ id: "x", fits: "y" }] },
    ],
  }),
);
const merged = JSON.parse(
  execFileSync("node", [cli, "detect"], { env: { ...process.env, DELEGATE_CATALOG: overlay }, encoding: "utf8" }),
);
assert.equal(merged.catalog_overlay, overlay);
assert.equal(merged.harnesses.length, catalog.harnesses.length + 1);
assert.ok(merged.harnesses.find((h) => h.id === "subagent").suggested.some((m) => m.id === "custom"));
assert.equal(merged.harnesses.find((h) => h.id === "opencode").list, "opencode models");
assert.equal(merged.harnesses.find((h) => h.id === "aider").available, false);

console.log("ok");
