import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allowlistPath, buildRequest, entries, loadCatalog, onPath, readAnswer } from "./delegate.mjs";

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

// save validates against the catalog and writes where the env var points.
const path = join(mkdtempSync(join(tmpdir(), "delegate-")), "allowlist.json");
const env = { ...process.env, DELEGATE_ALLOWLIST: path };
execFileSync("node", [cli, "save", '["inline:this-session","subagent:sonnet"]'], { env });
const saved = JSON.parse(readFileSync(path, "utf8"));
assert.deepEqual(saved.keys, ["inline:this-session", "subagent:sonnet"]);
assert.equal(saved.confidence_threshold, catalog.confidence_threshold);
assert.ok(!JSON.stringify(saved).includes("Runs under"), "allowlist stores keys, not a rubric snapshot");

assert.throws(
  () => execFileSync("node", [cli, "save", '["subagent:nope"]'], { env, stdio: "pipe" }),
  /not in catalog/,
);
assert.throws(() => execFileSync("node", [cli, "save", "[]"], { env, stdio: "pipe" }), /non-empty/);

// route without a key reports the roster instead of guessing.
const manual = JSON.parse(
  execFileSync("node", [cli, "route", "add a test"], { env: { ...env, TYPESAFE_API_KEY: "" }, encoding: "utf8" }),
);
assert.equal(manual.mode, "manual");
assert.equal(manual.candidates.length, 2);

// The overlay adds a model to an existing harness and a whole new harness.
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
assert.ok(merged.harnesses.find((h) => h.id === "subagent").models.some((m) => m.id === "custom"));
assert.equal(merged.harnesses.find((h) => h.id === "aider").available, false);

console.log("ok");
