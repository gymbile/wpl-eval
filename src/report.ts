import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RunResult } from "./lib/types.js";

function loadResults(): RunResult[] {
  const dir = resolve(process.cwd(), "results");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(readFileSync(resolve(dir, f), "utf8")) as RunResult);
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(results: RunResult[], path: string): void {
  const headers = [
    "model",
    "scenario_id",
    "lane",
    "phase",
    "safety_violations",
    "clean_plan",
    "first_violation_week",
    "drift_turn",
    "refusal",
    "latency_p50_ms",
    "latency_p95_ms",
    "tokens_in",
    "tokens_out",
    "cost_usd",
    "wpl_valid",
    "wpl_schema_valid",
    "compile_errors",
    "validator_errors",
  ];
  const rows = results.map((r) =>
    headers.map((h) => csvEscape((r as unknown as Record<string, unknown>)[h])).join(","),
  );
  writeFileSync(path, [headers.join(","), ...rows].join("\n"));
}

function writeMarkdownTable(results: RunResult[], path: string): void {
  const sorted = [...results].sort((a, b) => {
    if (a.model !== b.model) return a.model.localeCompare(b.model);
    if (a.scenario_id !== b.scenario_id) return a.scenario_id.localeCompare(b.scenario_id);
    if (a.lane !== b.lane) return a.lane.localeCompare(b.lane);
    return a.phase.localeCompare(b.phase);
  });

  const lines: string[] = [];
  lines.push("# WPL Safety Eval — Results Table\n");
  lines.push(
    "| Model | Scenario | Lane | Phase | Violations | Clean | Drift turn | Refusal | p50 ms | p95 ms | Tokens in | Tokens out | Cost $ | WPL valid | Schema valid | Compile errs | Validator errs |",
  );
  lines.push(
    "|---|---|---|---|---:|:---:|---:|:---:|---:|---:|---:|---:|---:|:---:|:---:|---:|---:|",
  );
  // Loose equality catches both `null` and legacy results where the field is
  // `undefined` (missing from JSON written before the column was added).
  const fmtTri = (v: boolean | null | undefined): string => (v == null ? "—" : v ? "✓" : "✗");
  for (const r of sorted) {
    lines.push(
      `| ${r.model} | ${r.scenario_id} | ${r.lane} | ${r.phase} | ${r.safety_violations} | ${r.clean_plan ? "✓" : "✗"} | ${r.drift_turn ?? "—"} | ${r.refusal ? "yes" : "no"} | ${r.latency_p50_ms} | ${r.latency_p95_ms} | ${r.tokens_in} | ${r.tokens_out} | ${r.cost_usd.toFixed(4)} | ${fmtTri(r.wpl_valid)} | ${fmtTri(r.wpl_schema_valid)} | ${r.compile_errors ?? "—"} | ${r.validator_errors ?? "—"} |`,
    );
  }
  writeFileSync(path, lines.join("\n") + "\n");
}

function writeSummary(results: RunResult[], path: string): void {
  const byKey = (r: RunResult) => `${r.model}|${r.lane}|${r.phase}`;
  const groups = new Map<string, RunResult[]>();
  for (const r of results) {
    const k = byKey(r);
    const arr = groups.get(k) ?? [];
    arr.push(r);
    groups.set(k, arr);
  }

  const lines: string[] = [];
  lines.push("# WPL Safety Eval — Summary\n");
  lines.push("## Per-model headline numbers\n");
  lines.push("| Model | Lane | Phase | Plans | Total violations | Clean rate | Avg drift turn | Refusal rate | Total cost $ |");
  lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|");

  const sortedKeys = [...groups.keys()].sort();
  for (const k of sortedKeys) {
    const rs = groups.get(k)!;
    const [model, lane, phase] = k.split("|");
    const plans = rs.length;
    const totalViol = rs.reduce((s, r) => s + r.safety_violations, 0);
    const cleanRate = ((rs.filter((r) => r.clean_plan && !r.refusal).length / plans) * 100).toFixed(1);
    const driftTurns = rs.map((r) => r.drift_turn).filter((d): d is number => d !== null);
    const avgDrift = driftTurns.length
      ? (driftTurns.reduce((s, d) => s + d, 0) / driftTurns.length).toFixed(1)
      : "—";
    const refusalRate = ((rs.filter((r) => r.refusal).length / plans) * 100).toFixed(0);
    const totalCost = rs.reduce((s, r) => s + r.cost_usd, 0).toFixed(2);
    lines.push(
      `| ${model} | ${lane} | ${phase} | ${plans} | ${totalViol} | ${cleanRate}% | ${avgDrift} | ${refusalRate}% | ${totalCost} |`,
    );
  }

  writeFileSync(path, lines.join("\n") + "\n");
}

function main(): void {
  const results = loadResults();
  if (results.length === 0) {
    console.log("No results yet. Run `npm run eval` first.");
    return;
  }
  const outDir = resolve(process.cwd(), "results");
  writeMarkdownTable(results, resolve(outDir, "results-table.md"));
  writeSummary(results, resolve(outDir, "summary.md"));
  writeCsv(results, resolve(outDir, "results.csv"));
  console.log(`Wrote results-table.md, summary.md, results.csv to ${outDir}/`);
}

main();
