# wpl-eval

Public safety evaluation for the [WPL (Wellness Plan Language)](https://wpl.dev) governance layer.

A two-lane benchmark that runs identical trainer-voice scenarios through two pipelines — **raw LLM output** vs **LLM + WPL governance** — across **7 models from OpenAI and Anthropic**, and reports a full metrics table (safety violations, drift, latency, cost, validity).

**Why this exists, in one paragraph.** An LLM will happily prescribe an exercise that's dangerous for a client's injury. WPL is a safety layer that makes the model write its plan through a structured grammar, then strips contraindicated exercises against that client's constraints before the plan is served — and this repo measures the difference. Across **560 trials** and **7 models** (OpenAI + Anthropic), raw LLMs produced a plan with a contraindicated exercise **32–51%** of the time; the *same* models routed through WPL: **8–17%** — a **3–5× reduction**, on every corpus and in both single- and multi-turn conversations. In multi-turn coaching chats, raw models forget a contraindication the user already stated **42%** of the time; through WPL, **6%** (and **0%** on the Anthropic set). Every number reproduces from the committed model outputs in `results/`.

**Current corpus: v0.6** — three sub-corpora (v0.5 OpenAI long-plan, v0.6 Anthropic long-plan, v0.6 short-plan), single-turn + multi-turn, 560 trials, ~$170 to reproduce. Frozen tag: [`v0.6.0`](https://github.com/gymbile/wpl-eval/releases/tag/v0.6.0). Full write-up: [`docs/V0_6_RESULTS.md`](docs/V0_6_RESULTS.md).

> **⚠️ Correction (2026-06-12):** the earlier `v0.6.0-anthropic` snapshot reported "0 safety violations across 180 Anthropic Lane B trials." That was a measurement-bug artifact — a plan-walker reading the wrong path in the compiled output, so the scorer saw an empty plan. It is fixed; every Lane B result was re-derived from stored model output (no new API calls). Do not cite `v0.6.0-anthropic`. The corrected numbers are below and in `docs/V0_6_RESULTS.md`.

## Headlines, v0.6 (corrected)

The contract's core job — stripping contraindicated exercises (the "blacklist" measure, apples-to-apples with v0.5):

| | Raw LLM (Lane A) | WPL public layer (Lane B) |
|---|---:|---:|
| Unsafe-plan rate, all corpora & phases | **32–51%** | **8–17%** |
| Reduction | — | **3–5× on every corpus, both phases** |
| Multi-turn drift (blacklist) | **42%** (44/105) | **6%** (0% on the Anthropic corpus) |

What the contract does **not** do (an honest gap, new in v0.6): on the short-plan corpus, the compiled form *surfaces* structural failures (insufficient rest days, over-fast progression, missing on-ramp) the raw prose lane is blind to — but the rule evaluator's only action today is `forbid_exercise`, so it reports those failures without yet preventing them. That's the v0.7 work.

Every number is reproducible from the committed `results/*.json` files.

## Since v0.6 (v0.7 / v0.7.1, shipped)

The v0.6 corrected numbers above remain the cited corpus — they are still the headline result. What changed since is engineering and methodology, not a new score:

- **v0.7 — `enforce()` is now in the published library.** The contraindicated-exercise stripping that Lane B exercises used to apply in the eval harness now lives in the published `@gymbile/wpl-validator` itself, so the served behaviour and the measured behaviour are the same code path.
- **v0.7 — honesty fixes.** Lane B rules were de-circularized (authored from the client's clinical picture rather than the grading blacklist); a single independent extractor model is used for every trial; the compiler **fails closed** on safety paths; confidence intervals were added; and the matcher plural gap was fixed (`push_ups` no longer slips past a `push_up` rule). Because the old Lane B rules were partly circular and the old matcher failed open, the Lane B figures are expected to come *down*, not up, on re-measurement.
- **v0.7.1 — canonical exercise catalog (SSOT).** The exercise vocabulary is now one canonical catalog as a single source of truth, vendored + codegen'd into each consumer with CI drift-checks — closing a production gap where a drifted catalog left a whole class of post-injury rehab exercises "unknown" to the live safety layer.
- **Packages published:** npm `@gymbile/wpl-validator@1.9.0`, `@gymbile/wpl-ai@2.1.0`; Hex `wpl_validator 1.9.0`, `wpl_ai 2.1.0`; spec tag `wpl v1.8.0`.

The de-circularized methodology has now been exercised: the **v0.7.0 lifecycle sweep** (5 evolving-client scenarios × 10 models × 3 vendors, 100 multi-turn trials) measured adaptability end-to-end — **210 → 10 lifecycle violations (21×), criterion pass rate 65% → 94%** under the WPL contract. Results: [`docs/V0_7_RESULTS.md`](docs/V0_7_RESULTS.md). The v0.6→v0.7→v0.7.1 methodology changes that made the measurement trustworthy: [`docs/V0_7_METHODOLOGY_CHANGES.md`](docs/V0_7_METHODOLOGY_CHANGES.md).

## Where to start

For the human-readable narrative and methodology, the [`docs/`](docs/) directory is the entry point:

| | What it is |
|---|---|
| [`docs/V0_6_RESULTS.md`](docs/V0_6_RESULTS.md) | **Start here.** The v0.6 results write-up — corrected cross-corpus numbers, the correction notice, the four-bug disclosure, short-plan + multi-turn methodology, native-JSON and END-markers probes. |
| [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) | Technical companion — research question, scenario design, scoring algorithm, drift methodology, validity threats. |
| [`docs/CLAIM_AUDIT.md`](docs/CLAIM_AUDIT.md) | Per-claim verification — quantitative claims trace to `results/<file>.json`. |
| [`docs/V0_6_SHORT_PLANS_AND_ANTHROPIC.md`](docs/V0_6_SHORT_PLANS_AND_ANTHROPIC.md) | Design doc for the short-plan corpus + Anthropic integration. |
| [`docs/charts/`](docs/charts/) | Press-ready hero charts (PNG + SVG), regenerated from `results/*.json`. |
| [`docs/archive/`](docs/archive/) | Pre-v0.5 historical drafts. |

The v0.5-era publication docs (`BLOG_POST.md`, `INDUSTRY_REPORT.md`, `PRESS_KIT.md`) describe the frozen v0.5.0 corpus and predate the v0.6 correction — read `V0_6_RESULTS.md` for current numbers.

## Quick start

```bash
git clone https://github.com/gymbile/wpl-eval.git
cd wpl-eval
git checkout v0.6.0                       # the corrected v0.6 corpus
npm install                               # pins @gymbile/wpl-ai ^2.1.0, @gymbile/wpl-validator ^1.9.0
cp .env.example .env                      # add OPENAI_API_KEY and ANTHROPIC_API_KEY
npm test                                  # 125 unit tests (scoring + short-plan rules + rule evaluator + cycle)
npm run eval -- --sweep=v0.6              # full sweep — single-turn + multi-turn, all corpora
node src/scripts/headline-all.mjs         # regenerate the cross-corpus headline tables
```

Total inference cost to reproduce the full corpus: **~$170** against 560 trials. Or re-derive every published number from the committed model output for **$0** — see below.

## Reproducing without re-spending

The 560 committed `results/*.json` files contain every raw model response (`raw_text` + `raw_texts_per_turn`) plus the Lane A extractor's raw output. That means:

- Lane B single-turn re-score (recompile raw_text + walk + score): `npx tsx src/scripts/rescore-lane-b.ts` — no API calls.
- Lane B multi-turn re-score (latest-valid-turn semantics): `npx tsx src/scripts/rescore-multiturn-lateststate.ts` — no API calls.
- Short-plan scorer re-derivation: `npx tsx src/scripts/rescore-shortplans.ts` — no API calls.
- Headline tables: `node src/scripts/headline-all.mjs`.

This is exactly how the v0.6 correction was produced: the walker bug was fixed and **every Lane B number re-derived from stored output for $0**. Every published number is offline-reproducible from the committed dumps — no further API spend needed unless you want new model outputs.

## What the two lanes do

**Lane A (raw):**
```
trainer prompt → LLM emits free-form plan → extractor LLM call → structured list → blacklist scoring
```

**Lane B (WPL governance):**
```
trainer prompt → LLM emits WPL-AI DSL → compileWplAi() → @gymbile/wpl-validator validate() + enforce(clientContext) → blacklist scoring
```

Lane A is a 2026-vintage baseline of how AI is deployed in consumer fitness apps today. Lane B is what the same model produces when it must speak through a structured grammar with compile-time validation and a rule engine that re-applies client constraints on every regeneration.

## Models evaluated (v0.6)

OpenAI:
- `gpt-5` — flagship (minimal reasoning effort, default)
- `gpt-5-mini` — mid-tier reasoning
- `gpt-5-nano` — cheapest reasoning
- `gpt-4.1` — older non-reasoning baseline

Anthropic:
- `claude-opus-4-7` — flagship (rejects the `temperature` param; model-controlled sampling, disclosed)
- `claude-sonnet-4-6` — mid-tier
- `claude-haiku-4-5` — cheapest

Google Gemini is on the v0.7 roadmap. The cross-vendor headline: the two flagships (Opus 4.7, gpt-5) are the *worst* raw-safety performers; the two cheapest (Haiku 4.5, gpt-4.1) are the safest. Capability degrades raw safety; the contract is what reduces it.

## Scenarios (20)

Trainer-voice client archetypes. The 15 v0.5 long-plan scenarios (all 12-week requests) plus 5 v0.6 short-plan scenarios (1–4 week requests with `block_purpose`-gated structural scoring):

| Class | Scenarios |
|---|---|
| Medical conditions | torn_meniscus, lumbar_disc, shoulder_impingement, post_csection_4wk, pregnancy_2nd_trimester, cardiac_post_mi |
| Cycle-aware | severe_dysmenorrhea, endometriosis_flares, pcos_irregular, perimenopause_variable, ocp_suppressed *(negative control)* |
| Constraint-adherence | type2_diabetes_nutrition, equipment_bodyweight_only, vegan_protein_target, asthma_exercise_induced |
| Short-plan *(v0.6)* | travel_hotel_2wk *(maintenance)*, peaking_powerlifting_3wk, postpartum_onramp_4wk *(on-ramp)*, post_illness_recond_3wk *(reconditioning)*, deload_1wk |

Full definitions and clinical citations in [`scenarios/scenarios.yaml`](scenarios/scenarios.yaml).

## Limitations (read before quoting any number)

- 20 scenarios is not exhaustive — it's a stratified snapshot.
- 7 models across 2 vendors is not all of LLM-space. v0.7 plans Google Gemini.
- Blacklists and short-plan structural thresholds are **clinician-cited but not clinician-validated**: every entry cites a published source, but the encoding was authored by the Gymbile team, not by clinicians reviewing the corpus. v0.7 adds named per-domain reviewers. The relative comparison (raw LLM vs WPL) is robust to this gap; the absolute labels are pending external sign-off.
- The contract **reports** short-plan structural failures (rest days, progression, on-ramp) but the rule evaluator does not yet **prevent** them — its only action today is `forbid_exercise`. v0.7 adds structural enforcement.
- Drift protocol is one realistic 8-turn trainer-conversation shape, not all shapes.
- `gpt-4.1`, `claude-sonnet-4-6`, and `claude-haiku-4-5-20251001` run at `temperature: 0`. The GPT-5 family (`gpt-5`, `gpt-5-mini`, `gpt-5-nano`) does not accept a temperature parameter, and `claude-opus-4-7` rejects it with a 400 — all four use model-controlled sampling and are not deterministic across runs. Disclosed asymmetry — see `docs/METHODOLOGY.md §3.5`.
- v0.6 found and fixed four measurement bugs (the Lane B walker, four short-plan scorer rules, multi-turn final-turn semantics, fence stripping). The full disclosure is in `docs/V0_6_RESULTS.md`. The older `v0.6.0-anthropic` tag predates these fixes and should not be cited.

## License

Apache 2.0. See [LICENSE](LICENSE).
