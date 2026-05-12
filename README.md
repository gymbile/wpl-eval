# wpl-eval

Public safety evaluation for the [WPL (Wellness Plan Language)](https://wpl.dev) governance layer.

A two-lane benchmark that runs identical trainer-voice scenarios through two pipelines — raw LLM output vs LLM + WPL governance — across multiple OpenAI models, and reports a full metrics table (safety violations, drift, latency, cost, validity).

The thesis: structured governance via WPL produces safer, more reproducible fitness programmes than raw LLM output, with a measurable cost/latency trade.

## Quick start

```bash
git clone https://github.com/gymbile/wpl-eval.git
cd wpl-eval
npm install
cp .env.example .env  # add your OPENAI_API_KEY
npm test              # rule-evaluator + scoring tests
npm run eval          # runs the full benchmark (~$150–250 of OpenAI spend)
npm run report        # aggregates results/ → results-table.md
```

## Reproducing the published headline numbers

Every number in the writeup at [wpl.dev/eval](https://wpl.dev/eval) derives from the JSON files emitted to `results/` by `npm run eval`. To reproduce:

1. Clone this repo at the published tag (`git checkout v0.1.0`).
2. `npm install` (lockfile pins exact versions, including `@gymbile/wpl-ai` and `@gymbile/wpl-validator`).
3. Add your `OPENAI_API_KEY` to `.env`.
4. `npm run eval` writes one JSON per `(model, scenario, lane, phase)` to `results/`.
5. `npm run report` aggregates those into `results-table.md`, `summary.md`, and `results.csv`.

The price table (`src/lib/pricing.ts`) is the only thing that drifts over time — when OpenAI re-prices, cost figures can be recomputed from logged tokens without re-running the benchmark.

## What the two lanes do

**Lane A (raw):**
```
trainer prompt → LLM emits free-form plan → extraction prompt → structured list → blacklist scoring
```

**Lane B (WPL):**
```
trainer prompt → LLM emits WPL-AI DSL → compileWplAi() → validate() → ruleEvaluator(clientContext) → final WPL JSON → blacklist scoring
```

Lane A is a 2026-vintage baseline of how AI is deployed in consumer fitness apps today. Lane B is what the same model produces when it must speak through a structured grammar with compile-time validation and a rule engine that re-applies client constraints on every regeneration.

## Models evaluated (v0.1)

- `gpt-5` — flagship
- `gpt-5-mini` — mid-tier
- `gpt-5-nano` — cheapest
- `gpt-4.1` — previous generation

Adding Claude / Gemini in v0.2 is a single new file in `src/models/`.

## Scenarios

10 trainer-voice client archetypes covering real safety and constraint surfaces:

| ID | Surface |
|---|---|
| torn_meniscus | Post-op knee, no-jumping/deep-flexion |
| lumbar_disc | Disc herniation, no loaded flexion |
| shoulder_impingement | Subacromial, no overhead loading |
| post_csection_4wk | 4 weeks post-CS, no abs/heavy lifting |
| pregnancy_2nd_trimester | 20 weeks pregnant, no supine after 16 |
| cardiac_post_mi | 6 mo post-MI, HR cap and no valsalva |
| type2_diabetes_nutrition | T2D + metformin, hypoglycaemia precautions |
| equipment_bodyweight_only | Constraint-adherence: no gym equipment |
| vegan_protein_target | Constraint-adherence: no animal products |
| asthma_exercise_induced | EIA, warm-up required |

Full definitions in [`scenarios/scenarios.yaml`](scenarios/scenarios.yaml). Blacklists, drift protocols, and clinical rationales are versioned with the eval.

## Limitations (read before quoting any number)

- 10 scenarios is not exhaustive — it's a snapshot of common surfaces.
- 4 OpenAI models is not all of LLM-space. v0.2 will add Anthropic + Google.
- Blacklists are curated. Items marked `[VERIFY]` need clinical signoff per scenario.
- The drift protocol is one realistic trainer-conversation shape, not all shapes.
- Lane A scoring relies on a fixed extraction prompt; spot-checks are documented in the writeup.

## License

Apache 2.0. See [LICENSE](LICENSE).
