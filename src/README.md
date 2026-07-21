# src/ — the benchmark harness

- `runner.ts` — CLI entry (`npm run eval`). Iterates model × scenario ×
  lane × phase, writes one JSON per trial. `--sweep=v0.5|v0.6|v0.7`,
  `--scenario=`, `--model=`, `--lane=`, `--phase=`, `--repeats=`, `--out=`.
- `report.ts` — turns a results dir into `results-table.md`,
  `summary.md`, `results.csv`, and (when lifecycle scenarios are present)
  `adaptation-matrix.md`. Optional dir arg, default `results/`.
- `rescore.ts` — offline Lane B re-scoring from stored output.
- `lanes/` — the two pipelines. `lane-a.ts`: raw LLM → fixed extractor →
  scoring. `lane-b.ts`: LLM → WPL-AI DSL → compile → validate →
  `enforce(ClientContext)` → scoring; carries the per-turn lifecycle
  state injection and latest-valid-turn semantics.
- `scoring/` — deterministic scorers: `blacklist.ts` (fuzzy matcher +
  static/flow-day rules), `short-plan.ts` (v0.6 structural rules),
  `lifecycle.ts` (v0.7 turn-range × week-range criteria), `drift.ts`,
  `extraction.ts` (fixed gpt-4.1 extractor), plus the generated matcher
  vocab (`matcher-vocab.generated.ts` — do not edit; see
  `scripts/gen-matcher-vocab.mjs`).
- `models/` — vendor adapters (OpenAI, Anthropic, Gemini) behind one
  `Model.chat()` interface with cross-vendor refusal heuristics.
- `lib/` — shared types (`types.ts`), lifecycle state helpers
  (`lifecycle.ts`), cycle projection, pricing table, env loading, stats.
- `scripts/` — analysis and probe scripts (headline tables, audits,
  rescores, the one-off probes whose outputs live in `../experiments/`).
