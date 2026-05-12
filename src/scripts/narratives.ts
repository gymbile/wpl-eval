// Generates publishable narrative markdown from results/*.json.
//
// Outputs to ../narratives/ (workspace-level, OUTSIDE the public repo) so
// we can quote raw model output without shipping it through GitHub.
//
//   ../narratives/by-scenario/<scenario>.md   per-scenario side-by-side
//   ../narratives/dramatic-moments.md         cherry-picked LinkedIn quotes
//   ../narratives/README.md                   index + headline numbers

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { RunResult, Scenario, Violation } from "../lib/types.js";

const RESULTS_DIR = resolve(process.cwd(), "results");
const OUT_DIR = resolve(process.cwd(), "../narratives");
const SCENARIOS_PATH = resolve(process.cwd(), "scenarios/scenarios.yaml");

mkdirSync(resolve(OUT_DIR, "by-scenario"), { recursive: true });

const scenarioDoc = parseYaml(readFileSync(SCENARIOS_PATH, "utf8")) as {
  scenarios: Scenario[];
};
const scenarios: Record<string, Scenario> = {};
for (const s of scenarioDoc.scenarios) scenarios[s.id] = s;

const rows = readdirSync(RESULTS_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(resolve(RESULTS_DIR, f), "utf8")) as RunResult)
  .filter((r) => !r.error);

// Tag-suffix models like `gpt-5+reason-medium` are noted but not in the
// locked sweep — separate them so the headline numbers stay clean.
const isLocked = (m: string) => !m.includes("+");
const lockedModelOrder = ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-5-nano"];

// ---- helpers ---------------------------------------------------------------

function snippet(text: string, needle: string, before = 250, after = 250): string {
  if (!text) return "_(no raw text captured)_";
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) {
    // Try fuzzier — drop underscores from needle.
    const fuzzy = needle.replace(/_/g, " ");
    const idx2 = text.toLowerCase().indexOf(fuzzy.toLowerCase());
    if (idx2 < 0) return "_(snippet not found in raw text — see full result JSON)_";
    return excerpt(text, idx2, before, after);
  }
  return excerpt(text, idx, before, after);
}

function excerpt(text: string, idx: number, before: number, after: number): string {
  const start = Math.max(0, idx - before);
  const end = Math.min(text.length, idx + after);
  const head = start > 0 ? "…" : "";
  const tail = end < text.length ? "…" : "";
  return head + text.slice(start, end).trim() + tail;
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((l) => "> " + l)
    .join("\n");
}

function findViolationNeedle(v: Violation): string {
  // Try to find the violation's `item` (canonical) in the raw text; fall
  // back to the underscored form, then the bare-word form.
  return v.item.replace(/_below_parallel|_above_parallel|_any(thing)?|_heavy/g, "").replace(/_/g, " ");
}

// ---- per-scenario doc ------------------------------------------------------

function renderScenario(scenario: Scenario): string {
  const lines: string[] = [];
  lines.push(`# ${scenario.id}`);
  lines.push("");
  lines.push(`**Persona:** ${scenario.persona.replace(/\n/g, " ").trim()}`);
  lines.push("");
  lines.push(`**Drift-check turn:** ${scenario.drift_check_at_turn}`);
  lines.push("");
  lines.push(`**Blacklist (the safety contract):**`);
  for (const ex of scenario.blacklist.exercises ?? []) lines.push(`- exercise: \`${ex}\``);
  for (const i of scenario.blacklist.intensities ?? [])
    lines.push(`- intensity: \`${i.domain}\` above \`${i.above}\``);
  for (const f of scenario.blacklist.foods ?? []) lines.push(`- food: \`${f}\``);
  for (const f of scenario.blacklist.foods_pre_fasted_cardio ?? [])
    lines.push(`- food (pre-fasted-cardio): \`${f}\``);
  lines.push("");

  for (const phase of ["single", "multi"] as const) {
    lines.push(`## Phase: ${phase}-turn`);
    lines.push("");

    for (const model of lockedModelOrder) {
      const a = rows.find(
        (r) => r.model === model && r.scenario_id === scenario.id && r.lane === "A" && r.phase === phase,
      );
      const b = rows.find(
        (r) => r.model === model && r.scenario_id === scenario.id && r.lane === "B" && r.phase === phase,
      );
      if (!a && !b) continue;

      lines.push(`### ${model}`);
      lines.push("");

      if (a) {
        lines.push(`**Lane A (raw LLM):** ${a.safety_violations} violations, ${a.clean_plan ? "clean ✓" : "unsafe ✗"}${a.drift_turn ? `, drifted at turn ${a.drift_turn}` : ""}.`);
        if (a.violations.length && a.raw_text) {
          for (const v of a.violations.slice(0, 3)) {
            const needle = findViolationNeedle(v);
            const found = snippet(a.raw_text, needle, 200, 300);
            lines.push("");
            lines.push(`*Violation:* \`${v.item}\`${v.week ? ` (week ${v.week})` : ""}`);
            lines.push("");
            lines.push(quote(found));
          }
          if (a.violations.length > 3) lines.push(`\n_(and ${a.violations.length - 3} more violations — see results JSON)_`);
        } else if (a.violations.length === 0) {
          lines.push("");
          lines.push("_Lane A clean — no blacklist hits._");
        }
        lines.push("");
      }

      if (b) {
        if (b.wpl_valid) {
          lines.push(`**Lane B (WPL):** compiled cleanly (${b.compile_errors} compile errors, ${b.validator_errors} validator notes). ${b.safety_violations} safety violations.`);
          if (b.extracted_plan && b.extracted_plan.exercises.length) {
            const sample = b.extracted_plan.exercises.slice(0, 5).map((e) => e.name).join(", ");
            lines.push("");
            lines.push(`Sample exercises WPL served: ${sample}${b.extracted_plan.exercises.length > 5 ? "…" : ""}`);
          }
        } else {
          lines.push(`**Lane B (WPL):** failed to compile (${b.compile_errors} compile errors). Served nothing — fail-closed.`);
        }
        lines.push("");
      }
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

// ---- dramatic moments ------------------------------------------------------

interface Moment {
  model: string;
  scenario_id: string;
  phase: "single" | "multi";
  drift_turn: number | null;
  violation: Violation;
  quote: string;
  trainer_prompt: string;
  source_file: string;
}

function collectMoments(): Moment[] {
  const moments: Moment[] = [];

  for (const r of rows) {
    if (!isLocked(r.model) || r.lane !== "A" || r.violations.length === 0) continue;

    if (r.phase === "single") {
      for (const v of r.violations) {
        const needle = findViolationNeedle(v);
        if (!r.raw_text) continue;
        const found = snippet(r.raw_text, needle, 150, 250);
        if (found.includes("_(snippet not found")) continue;
        const scenario = scenarios[r.scenario_id]!;
        moments.push({
          model: r.model,
          scenario_id: r.scenario_id,
          phase: "single",
          drift_turn: null,
          violation: v,
          quote: found,
          trainer_prompt: scenario.single_turn_prompt,
          source_file: `${r.model}__${r.scenario_id}__A__single.json`,
        });
      }
    } else {
      // Multi-turn — prefer the drift turn raw text if captured.
      const driftTurn = r.drift_turn ?? (r.extracted_plans_per_turn?.length ?? 1);
      const driftIdx = Math.max(0, Math.min(driftTurn - 1, (r.raw_texts_per_turn?.length ?? 1) - 1));
      const turnText = r.raw_texts_per_turn?.[driftIdx] ?? r.raw_text;
      if (!turnText) continue;
      const scenario = scenarios[r.scenario_id]!;
      const trainerTurn = scenario.multi_turn[driftIdx] ?? scenario.multi_turn[0] ?? "";
      for (const v of r.violations.slice(0, 1)) {
        const needle = findViolationNeedle(v);
        const found = snippet(turnText, needle, 150, 250);
        if (found.includes("_(snippet not found")) continue;
        moments.push({
          model: r.model,
          scenario_id: r.scenario_id,
          phase: "multi",
          drift_turn: r.drift_turn,
          violation: v,
          quote: found,
          trainer_prompt: trainerTurn,
          source_file: `${r.model}__${r.scenario_id}__A__multi.json`,
        });
      }
    }
  }
  return moments;
}

function renderMoments(moments: Moment[]): string {
  const lines: string[] = [];
  lines.push("# Dramatic moments — quotable extracts for LinkedIn posts");
  lines.push("");
  lines.push(
    "Cherry-picked from `results/*.json`. Each moment is the model writing something contraindicated by the scenario's safety blacklist, with the trainer's prompt that elicited it.",
  );
  lines.push("");
  lines.push("All quotes are verbatim from the model's response. Snippet windows are ±200 chars around the violation.");
  lines.push("");

  // Sort by: drift_turn (earlier = more dramatic), then violation count.
  moments.sort((a, b) => {
    const at = a.drift_turn ?? 99;
    const bt = b.drift_turn ?? 99;
    return at - bt;
  });

  // Group early drift moments (turn ≤ 4) as the headline section.
  const early = moments.filter((m) => m.drift_turn !== null && m.drift_turn <= 4);
  const lateOrSingle = moments.filter((m) => !early.includes(m));

  if (early.length) {
    lines.push("## Early drift (turns 1–4) — constraint forgotten quickly");
    lines.push("");
    for (const m of early.slice(0, 10)) {
      lines.push(`### ${m.model} / ${m.scenario_id} / turn ${m.drift_turn}`);
      lines.push("");
      lines.push(`**Trainer's prompt at this turn:** *"${m.trainer_prompt.replace(/\n/g, " ").trim()}"*`);
      lines.push("");
      lines.push(`**Violation:** \`${m.violation.item}\` (${m.violation.kind})`);
      lines.push("");
      lines.push(`**Model said:**`);
      lines.push("");
      lines.push(quote(m.quote));
      lines.push("");
      lines.push(`*Source: \`${m.source_file}\`*`);
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  lines.push("## Single-turn safety failures (no drift — model just got it wrong)");
  lines.push("");
  const singles = lateOrSingle.filter((m) => m.phase === "single").slice(0, 10);
  for (const m of singles) {
    lines.push(`### ${m.model} / ${m.scenario_id}`);
    lines.push("");
    lines.push(`**Trainer's prompt:** *"${m.trainer_prompt.replace(/\n/g, " ").slice(0, 240).trim()}…"*`);
    lines.push("");
    lines.push(`**Violation:** \`${m.violation.item}\` (${m.violation.kind})${m.violation.week ? `, week ${m.violation.week}` : ""}`);
    lines.push("");
    lines.push(`**Model said:**`);
    lines.push("");
    lines.push(quote(m.quote));
    lines.push("");
    lines.push(`*Source: \`${m.source_file}\`*`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

// ---- index ----------------------------------------------------------------

function renderIndex(): string {
  const lockedRows = rows.filter((r) => isLocked(r.model));
  const allA = lockedRows.filter((r) => r.lane === "A");
  const allB = lockedRows.filter((r) => r.lane === "B");
  const aViol = allA.reduce((s, r) => s + r.safety_violations, 0);
  const bViol = allB.reduce((s, r) => s + r.safety_violations, 0);
  const aDrift = allA.filter((r) => r.drift_turn !== null).length;

  const lines: string[] = [];
  lines.push("# wpl-eval narratives");
  lines.push("");
  lines.push("**Workspace-only.** Generated from `wpl-eval/results/*.json`. Quotes verbatim from the model responses. Sources cited per entry.");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Numbers at a glance");
  lines.push("");
  lines.push(`- Total runs: **${lockedRows.length}** (${allA.length} Lane A + ${allB.length} Lane B)`);
  lines.push(`- Lane A safety violations: **${aViol}**`);
  lines.push(`- Lane B safety violations: **${bViol}**`);
  lines.push(`- Lane A multi-turn drift: **${aDrift}/${allA.filter((r) => r.phase === "multi").length}** conversations`);
  lines.push("");
  lines.push("## Files");
  lines.push("");
  lines.push("- [`dramatic-moments.md`](./dramatic-moments.md) — cherry-picked LinkedIn-ready quotes");
  lines.push("- `by-scenario/<id>.md` — full per-scenario breakdown across all 4 models, both lanes, both phases");
  lines.push("");
  lines.push("## Per-scenario documents");
  lines.push("");
  for (const id of Object.keys(scenarios).sort()) {
    lines.push(`- [\`${id}\`](./by-scenario/${id}.md)`);
  }
  lines.push("");
  return lines.join("\n");
}

// ---- main -----------------------------------------------------------------

let scenarioCount = 0;
for (const id of Object.keys(scenarios)) {
  const md = renderScenario(scenarios[id]!);
  writeFileSync(resolve(OUT_DIR, "by-scenario", `${id}.md`), md);
  scenarioCount++;
}

const moments = collectMoments();
writeFileSync(resolve(OUT_DIR, "dramatic-moments.md"), renderMoments(moments));
writeFileSync(resolve(OUT_DIR, "README.md"), renderIndex());

console.log(`Wrote ${scenarioCount} per-scenario narratives + dramatic-moments.md + README.md to ${OUT_DIR}`);
console.log(`Captured ${moments.length} dramatic moments.`);
