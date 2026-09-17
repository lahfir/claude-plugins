#!/usr/bin/env node
/**
 * delegate -- decide who runs a task: this session, a sub-agent, or an outside CLI.
 *
 *   delegate.mjs detect                       what this machine can reach, as JSON
 *   delegate.mjs save '[{...}]'              write the allowlist (also reads stdin)
 *   delegate.mjs route "<task>"               ask TypeSafe which allowlisted entry fits
 *
 * catalog.json holds harness knowledge: what the harness is, how to launch it, and
 * the command that lists its models. The allowlist holds model knowledge and policy:
 * which models you permit and what each one is good and bad at. The split is forced
 * by scale -- opencode alone lists 959 models, so no bundled file can describe them.
 * Detection is the floor: route drops an entry whose CLI is not on this machine right
 * now, so the same allowlist travels between devices.
 *
 * Env: TYPESAFE_API_KEY (without it, route reports the roster and you decide),
 *      DELEGATE_ALLOWLIST and DELEGATE_CATALOG (path overrides),
 *      CLAUDE_CONFIG_DIR (default location for both).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const overlayPath = () =>
  process.env.DELEGATE_CATALOG ||
  join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "delegate-catalog.json");

/**
 * The bundled catalog, plus the user's own overlay if they wrote one. A plugin
 * update replaces the bundled file, so anything hand-added belongs in the overlay.
 * Same shape; a harness id already present gains the overlay's models.
 */
export const loadCatalog = () => {
  const catalog = JSON.parse(readFileSync(join(here, "..", "catalog.json"), "utf8"));
  if (!existsSync(overlayPath())) return catalog;
  const overlay = JSON.parse(readFileSync(overlayPath(), "utf8"));
  if (overlay.confidence_threshold != null) catalog.confidence_threshold = overlay.confidence_threshold;
  for (const h of overlay.harnesses ?? []) {
    const base = catalog.harnesses.find((c) => c.id === h.id);
    if (base) base.models.push(...h.models);
    else catalog.harnesses.push(h);
  }
  return catalog;
};

export const allowlistPath = () =>
  process.env.DELEGATE_ALLOWLIST ||
  join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "delegate-allowlist.json");

/** PATH lookup without a subprocess, so it behaves the same on every platform. */
export const onPath = (bin) => {
  const exts = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  return (process.env.PATH || "")
    .split(delimiter)
    .some((dir) => dir && exts.some((e) => existsSync(join(dir, bin + e))));
};

export const available = (h) => h.bin === null || onPath(h.bin);

/** The catalog's suggested models as flat candidates. A seed for setup, not a roster. */
export const entries = (catalog) =>
  catalog.harnesses.flatMap((h) =>
    h.models.map((m) => ({
      key: `${h.id}:${m.id}`,
      harness: h.id,
      model: m.id,
      launch: h.launch.replaceAll("{model}", m.id),
      // The option key is not sent to the model, so the harness's own properties
      // must live in the rubric. Two harnesses can offer the same model.
      rubric: `Runs under ${h.id}. ${h.traits} ${m.fits}`,
    })),
  );

/**
 * Allowlist entries joined to their harness. The rubric is the harness's bundled
 * `traits` plus the entry's own `fits`, so a catalog update still reaches every
 * entry while the per-model judgement stays where the user wrote it.
 */
export const resolve = (catalog, list) => {
  if (!Array.isArray(list.entries)) {
    throw new Error(
      list.keys
        ? "allowlist is in the old keys format -- rerun /delegate:setup"
        : "allowlist has no entries array -- rerun /delegate:setup",
    );
  }
  const byId = new Map(catalog.harnesses.map((h) => [h.id, h]));
  return list.entries.map((e) => {
    const h = byId.get(e.harness);
    return {
      key: `${e.harness}:${e.model}`,
      harness: e.harness,
      model: e.model,
      known: Boolean(h),
      launch: (e.launch ?? h?.launch ?? "").replaceAll("{model}", e.model),
      rubric: h ? `Runs under ${h.id}. ${h.traits} ${e.fits}` : e.fits,
    };
  });
};

export const buildRequest = (task, candidates) => ({
  state: { task },
  model: "jev-latest",
  questions: {
    pick: {
      type: "choice",
      instructions:
        "Who should run `task`? Match the judgement and the access the task really needs to what the option offers. Overspending on mechanical work wastes money; underspending on work that decides whether a claim is true produces a wrong answer that later work builds on. An option that cannot write files cannot do a task that must change files.",
      criteria: Object.fromEntries(candidates.map((c) => [c.key, c.rubric])),
    },
  },
});

export const readAnswer = (body) => {
  const a = body?.answers?.pick;
  if (a?.type !== "choice") return { error: "response carried no choice answer" };
  return { key: a.choice, confidence: a.confidence, probabilities: a.probabilities };
};

const out = (o) => console.log(JSON.stringify(o, null, 2));

const detect = (catalog) =>
  out({
    typesafe_key: Boolean(process.env.TYPESAFE_API_KEY),
    allowlist_path: allowlistPath(),
    allowlist_exists: existsSync(allowlistPath()),
    catalog_overlay: existsSync(overlayPath()) ? overlayPath() : null,
    harnesses: catalog.harnesses.map((h) => ({
      id: h.id,
      available: available(h),
      always_present: h.bin === null,
      traits: h.traits,
      list: h.list,
      suggested: h.models.map((m) => ({ id: m.id, fits: m.fits })),
    })),
  });

const save = (catalog, raw) => {
  let entries;
  try {
    entries = JSON.parse(raw);
  } catch {
    throw new Error(`expected a JSON array of entries, got: ${raw.slice(0, 80)}`);
  }
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("allowlist must be a non-empty array");

  const known = new Set(catalog.harnesses.map((h) => h.id));
  const str = (v) => typeof v === "string" && v.trim() !== "";
  entries.forEach((e, i) => {
    const at = `entry ${i}`;
    if (!known.has(e?.harness)) throw new Error(`${at}: unknown harness ${JSON.stringify(e?.harness)}`);
    if (!str(e.model)) throw new Error(`${at}: model must be a non-empty string`);
    // `fits` is the whole rubric the router judges against, so an entry without one
    // is an option the model cannot reason about. Refuse it rather than route blind.
    if (!str(e.fits)) throw new Error(`${at} (${e.harness}:${e.model}): fits must be a non-empty string`);
    if (e.launch !== undefined && !str(e.launch)) throw new Error(`${at}: launch must be a non-empty string`);
  });

  const file = {
    confidence_threshold: catalog.confidence_threshold,
    entries: entries.map(({ harness, model, fits, launch }) =>
      launch === undefined ? { harness, model, fits } : { harness, model, fits, launch },
    ),
  };
  mkdirSync(dirname(allowlistPath()), { recursive: true });
  writeFileSync(allowlistPath(), `${JSON.stringify(file, null, 2)}\n`);
  out({ written: allowlistPath(), entries: file.entries.map((e) => `${e.harness}:${e.model}`) });
};

const route = async (catalog, task) => {
  const path = allowlistPath();
  if (!existsSync(path)) throw new Error(`no allowlist at ${path} -- run /delegate:setup first`);
  const list = JSON.parse(readFileSync(path, "utf8"));
  const byHarness = new Map(catalog.harnesses.map((h) => [h.id, h]));
  const all = resolve(catalog, list);

  const unknown = all.filter((e) => !e.known);
  const unavailable = all.filter((e) => e.known && !available(byHarness.get(e.harness)));
  const candidates = all.filter((e) => e.known && !unavailable.includes(e));
  if (candidates.length === 0) throw new Error("no allowlisted entry is reachable on this machine");

  if (!process.env.TYPESAFE_API_KEY) {
    return out({ mode: "manual", reason: "TYPESAFE_API_KEY unset", task, candidates });
  }

  // ponytail: no retry or backoff. A probe that hits a 429 is rerun by hand.
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildRequest(task, candidates)),
  }).catch((e) => ({ ok: false, status: 0, statusText: String(e) }));
  if (!res.ok) throw new Error(`typesafe ${res.status} ${res.statusText}`);

  const answer = readAnswer(await res.json());
  if (answer.error) throw new Error(answer.error);
  const pick = candidates.find((c) => c.key === answer.key);
  const threshold = list.confidence_threshold ?? catalog.confidence_threshold;

  out({
    mode: "picked",
    task,
    pick: answer.key,
    harness: pick.harness,
    model: pick.model,
    launch: pick.launch,
    confidence: answer.confidence,
    threshold,
    below_threshold: answer.confidence < threshold,
    probabilities: answer.probabilities,
    dropped_unavailable: unavailable.map((e) => e.key),
    dropped_unknown: unknown.map((e) => e.key),
  });
};

const main = async ([cmd, ...rest]) => {
  const catalog = loadCatalog();
  if (cmd === "detect") return detect(catalog);
  if (cmd === "save") return save(catalog, rest.join(" ") || readFileSync(0, "utf8"));
  if (cmd === "route") {
    const task = rest.join(" ").trim();
    if (!task) throw new Error('usage: delegate.mjs route "<task>"');
    return route(catalog, task);
  }
  throw new Error("usage: delegate.mjs detect | save '<json array>' | route \"<task>\"");
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
