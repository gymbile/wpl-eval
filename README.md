# wpl-eval

Public safety evaluation for the [WPL (Wellness Plan Language)](https://wpl.dev) governance layer.

A two-lane benchmark that runs identical trainer-voice scenarios through two pipelines — **raw LLM output** vs **LLM + WPL governance** — across multiple OpenAI models, and reports a full metrics table (safety violations, drift, latency, cost, validity).

**Current corpus: v0.5** (`@gymbile/wpl-ai ^1.13.0`, 240 trials, $37.27 to reproduce).

## Headlines, v0.5

| | Raw LLM (Lane A) | WPL public layer (Lane B) |
|---|---:|---:|
| Plans containing unsafe content | **43/120 (36%)** | **6/120 (5%)** |
| Total violations | **207** | **28** |
| Reduction | — | **86% on both** |
| Plans served / compiled | 120/120 | 109/120 (91%) |
| Plans complete (≥10 wk) | 120/120 | 64/120 (53%) |
| Multi-turn drift | **25/60 (42%)** | **0/60** |

Every number is reproducible from the committed `results/*.json` files.

## Where to start

For the human-readable narrative and methodology, the [`docs/`](docs/) directory is the entry point:

| | What it is |
|---|---|
| [`docs/BLOG_POST.md`](docs/BLOG_POST.md) | Conversational launch post. Cycle-aware angle, real verbatim model failures, JSON-linked. |
| [`docs/INDUSTRY_REPORT.md`](docs/INDUSTRY_REPORT.md) | Investor-positioning industry report. Architecture, trade-offs, what's measured vs claimed. |
| [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) | Technical companion — research question, scenario design, scoring algorithm, drift methodology, validity threats. |
| [`docs/PRESS_KIT.md`](docs/PRESS_KIT.md) | Media kit. Six quote-ready moments, each anchored to a specific `results/<file>.json`. |
| [`docs/CLAIM_AUDIT.md`](docs/CLAIM_AUDIT.md) | Per-claim verification — every quantitative claim in the four docs above traces here. |
| [`docs/DIFF_v0.4_to_v0.5.md`](docs/DIFF_v0.4_to_v0.5.md) | Changelog. Why v0.5 numbers differ from earlier versions. |
| [`docs/V0_6_LIFECYCLE_SCENARIOS.md`](docs/V0_6_LIFECYCLE_SCENARIOS.md) | Roadmap. Lifecycle scenarios for measuring adaptability in v0.6. |
| [`docs/charts/`](docs/charts/) | Four press-ready hero charts (PNG + SVG), regenerated directly from `results/*.json`. |
| [`docs/archive/`](docs/archive/) | Pre-v0.5 historical drafts. |

The four active publication docs all carry a "Audited 2026-05-16 against `results/*.json`" footer.

## Quick start

```bash
git clone https://github.com/gymbile/wpl-eval.git
cd wpl-eval
git checkout v0.5.0                       # the v0.5 corpus
npm install                               # pins @gymbile/wpl-ai ^1.13.0, @gymbile/wpl-validator ^1.7.1
cp .env.example .env                      # add your OPENAI_API_KEY
npm test                                  # 71 unit tests (scoring + rule evaluator + cycle arithmetic)
npm run eval                              # full sweep — 4 models × 15 scenarios × 2 lanes × 2 phases = 240 trials
npx tsx src/scripts/normalise-results.ts  # re-compile Lane B raw_text against linked wpl-ai version
npm run report                            # aggregates results/*.json → tables
python3 docs/charts/generate.py           # regenerate hero charts (requires matplotlib)
```

Total OpenAI inference cost to reproduce: **$37.27** against 240 trials, ~11 hours wall-clock.

## Reproducing without re-spending

The 240 committed `results/*.json` files contain every raw model response (`raw_text` + `raw_texts_per_turn`) plus the Lane A extractor's raw output (`extractor_raw_per_turn`). That means:

- Scoring can be re-derived offline against a different blacklist (`npx tsx src/rescore.ts` — no API calls).
- Lane B compilation can be re-derived offline against a different `@gymbile/wpl-ai` version (`npx tsx src/scripts/normalise-results.ts` — no API calls).
- Re-extraction of Lane A from raw prose only needs API calls if you change the extraction prompt or schema.

Every published number is **offline-reproducible from the committed dumps** — no further API spend ever needed unless you want new model outputs.

## What the two lanes do

**Lane A (raw):**
```
trainer prompt → LLM emits free-form plan → extractor LLM call → structured list → blacklist scoring
```

**Lane B (WPL governance):**
```
trainer prompt → LLM emits WPL-AI DSL → compileWplAi() → @gymbile/wpl-validator → ruleEvaluator(clientContext) → blacklist scoring
```

Lane A is a 2026-vintage baseline of how AI is deployed in consumer fitness apps today. Lane B is what the same model produces when it must speak through a structured grammar with compile-time validation and a rule engine that re-applies client constraints on every regeneration.

## Models evaluated (v0.5)

- `gpt-5` — flagship (minimal reasoning effort, default)
- `gpt-5-mini` — mid-tier reasoning
- `gpt-5-nano` — cheapest reasoning
- `gpt-4.1` — older non-reasoning baseline

Adding Anthropic Claude / Google Gemini is on the v0.6 roadmap (`docs/V0_6_LIFECYCLE_SCENARIOS.md` + provider-agnostic runner).

## Scenarios (15)

Trainer-voice client archetypes covering three classes:

| Class | Scenarios |
|---|---|
| Medical conditions | torn_meniscus, lumbar_disc, shoulder_impingement, post_csection_4wk, pregnancy_2nd_trimester, cardiac_post_mi |
| Cycle-aware | severe_dysmenorrhea, endometriosis_flares, pcos_irregular, perimenopause_variable, ocp_suppressed *(negative control)* |
| Constraint-adherence | type2_diabetes_nutrition, equipment_bodyweight_only, vegan_protein_target, asthma_exercise_induced |

Full definitions and clinical citations in [`scenarios/scenarios.yaml`](scenarios/scenarios.yaml).

## Limitations (read before quoting any number)

- 15 scenarios is not exhaustive — it's a stratified snapshot.
- 4 OpenAI models is not all of LLM-space. v0.6 plans Anthropic + Google.
- Blacklists are curated; one named clinical reviewer per domain is the next credibility step (see [`docs/PRESS_KIT.md`](docs/PRESS_KIT.md) for the reviewer-quote stubs).
- Drift protocol is one realistic 8-turn trainer-conversation shape, not all shapes.
- Cycle-scenario scoring carries a documented asymmetry: the scorer flags off-flow placements of `exercises_on_flow_days` because Lane A prose extraction has no per-day calendar resolution. Lane B's runtime correctly strips only on actual flow days. v0.6 narrows the scorer to remove the false-positive class. Documented in `docs/METHODOLOGY.md` §11.

## License

Apache 2.0. See [LICENSE](LICENSE).
