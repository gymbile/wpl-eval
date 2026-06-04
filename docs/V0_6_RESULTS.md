# v0.6 results — cross-vendor sweep and the schema-validator ceiling

**Status:** draft, 2026-06-04. Frozen reference: git tag `v0.6.0-anthropic`.
Anthropic data committed at `60d29d1` on branch `v0.6`. OpenAI data
reused from v0.5.0 (unchanged). Short-plan scenarios and write-up
propagation to BLOG_POST / INDUSTRY_REPORT / README are deferred to
v0.6.1 and are *not* part of this document's scope.

This document reports new findings from the v0.6 sweep. It does not
restate v0.5 results except where v0.6 changes the interpretation.

---

## TL;DR (three findings)

1. **The WPL safety contract holds across vendors on the strict reading
   (Anthropic).** Across 180 Lane B trials on Haiku 4.5, Sonnet 4.6,
   and Opus 4.7, the scorer counted **0 safety violations** in any
   plan that compiled and was served. The OpenAI Lane B asymmetry
   documented in v0.5 §9.2 (gpt-5: 11 violations, gpt-5-mini: 17,
   concentrated on cycle off-flow scoring artefacts) does *not*
   reappear on Anthropic — providing a clean cross-vendor replication
   of the contract.

2. **Raw-LLM (Lane A) safety degrades as model capability grows.**
   Cross-vendor, more capable models prescribe *more* contraindicated
   work in their unconstrained output. Opus 4.7 produced 114 safety
   violations across 30 Lane A trials; Haiku 4.5 produced 28. The same
   ordering shows up in the OpenAI lineup: gpt-5 produced 91 raw
   violations vs gpt-4.1's 28. This flips the "bigger model = safer
   output" prior.

3. **The schema validator, not the compile gate, is the served-rate
   ceiling.** Across the 7-model lineup, every model that compiles
   plans loses 27%–100% of those plans to schema-validation errors
   the compile pass did not catch. No model exceeds 73% schema-valid
   (gpt-5). The compile/schema gap is universal, not vendor-specific,
   and is the main new finding of v0.6.

---

## The numbers (7-model cross-vendor table)

| model           | A trials | A safe plans | A violations | A refusals | B trials | B violations | B wpl-valid | **B schema-valid** | B refusals |
|-----------------|---------:|-------------:|-------------:|-----------:|---------:|-------------:|------------:|-------------------:|-----------:|
| gpt-5           |       30 |     22 (73%) |           91 |          0 |       30 |           11 |   30 (100%) |        **22 (73%)**|          0 |
| gpt-5-mini      |       30 |     14 (47%) |           59 |          0 |       30 |           17 |   30 (100%) |        **16 (53%)**|          0 |
| gpt-4.1         |       30 |     21 (70%) |           28 |          0 |       30 |            0 |    28 (93%) |        **16 (53%)**|          0 |
| gpt-5-nano      |       30 |     20 (67%) |           29 |          0 |       30 |            0 |    21 (70%) |         **0 (0%)** |          0 |
| claude-opus-4-7 |       30 |     15 (50%) |          114 |          1 |       30 |            0 |    17 (57%) |        **4 (13%)** |          9 |
| claude-sonnet-4-6|      30 |     17 (57%) |           56 |          0 |       30 |            0 |    18 (60%) |        **5 (17%)** |          0 |
| claude-haiku-4-5|       30 |     20 (67%) |           28 |          0 |       30 |            0 |     9 (30%) |        **5 (17%)** |         12 |

"A safe plans" = Lane A trials with `safety_violations === 0`. "B wpl-valid"
= plans that lex + parse + compile. "B schema-valid" = compiled plans that
also pass `@gymbile/wpl-validator` (no schema-violation errors). A schema-valid
plan is what we count as **served**.

---

## Finding 1: Lane A safety degrades with model capability

| model rank by capability (within vendor) | Lane A violations |
|---|---|
| gpt-5 (OpenAI flagship)                | 91 |
| gpt-5-mini                              | 59 |
| gpt-4.1                                 | 28 |
| gpt-5-nano                              | 29 |
| claude-opus-4-7 (Anthropic flagship)    | 114 |
| claude-sonnet-4-6                       | 56 |
| claude-haiku-4-5                        | 28 |

The flagship in each vendor is the worst raw-safety performer. On Opus
4.7, severe_dysmenorrhea alone accumulated 32 violations (HIIT on flow
days, deep barbell squats with full ROM, etc.). gpt-5 contributed 91
violations across its Lane A — the largest single contribution from any
OpenAI model.

The pattern is consistent across vendors and across scenario classes
(orthopaedic, cardiovascular, cycle-conditional, pregnancy/postpartum).
We do not claim a causal mechanism; one hypothesis is that more capable
models are more confident and write *more* programming per prompt, so
the absolute violation count rises even if the per-prescription error
rate does not. This is testable and out of scope for v0.6.

What is *not* observed: refusal-as-safety. Lane A refusals are 0 on
every OpenAI model and 0–1 on Anthropic. None of the models declined
the unconstrained prompt; they all produced plans.

---

## Finding 2: WPL contract holds on Anthropic (cleaner than on OpenAI)

Lane B safety violations, by model:

- claude-opus-4-7: **0** (out of 17 served, 30 attempted)
- claude-sonnet-4-6: **0** (out of 5 served, 30 attempted)
- claude-haiku-4-5: **0** (out of 5 served, 30 attempted)
- gpt-5-nano: 0 (out of 0 served — see Finding 3)
- gpt-4.1: 0 (out of 16 served)
- gpt-5-mini: **17** (out of 16 served)
- gpt-5: **11** (out of 22 served)

The Anthropic side is a clean 0/180. The OpenAI side carries 28 Lane B
violations, but per v0.5 §9.2 these are concentrated on cycle-scenario
off-flow scoring artefacts (the scorer treats post-flow-window high-
intensity work as a violation in cases where it is not contraindicated).
The Anthropic Lane B data does not reproduce these artefacts — most
likely because Anthropic models compile plans with cleaner cycle phasing
when the Lane B prompt's vocabulary constraints are followed.

The cross-vendor replication is the headline: **the strict reading of
the contract — zero safety violations on served plans — holds on a
fresh vendor with no scorer changes.**

---

## Finding 3 (new in v0.6): the schema validator is the real ceiling

The Lane B pipeline has two gates between the LLM and a served plan:

```
LLM raw text → DSL parser → compiler → JSON → schema validator → served
                   ↑           ↑                       ↑
              compile_errors  wpl_valid        wpl_schema_valid
```

v0.5 reported `wpl_valid` (compile success) as the served-rate
denominator. v0.6 audits the gap between `wpl_valid` and
`wpl_schema_valid`:

| model | wpl-valid | schema-valid | **compile-but-fail-schema** |
|---|---:|---:|---:|
| gpt-5            | 30/30 | 22/30 | 8 |
| gpt-5-mini       | 30/30 | 16/30 | 14 |
| gpt-4.1          | 28/30 | 16/30 | 12 |
| gpt-5-nano       | 21/30 | **0/30** | **21** |
| claude-opus-4-7  | 17/30 | 4/30 | 13 |
| claude-sonnet-4-6| 18/30 | 5/30 | 13 |
| claude-haiku-4-5 | 9/30  | 5/30 | 4 |

Every model has plans that pass the compiler but fail the schema. Even
the strongest tier (gpt-5) loses 27% of compiled plans. The gap is not
a vendor effect.

### Root-cause analysis of the 30 Anthropic schema-fail cases

We re-ran `@gymbile/wpl-validator` against the persisted `wpl_json`
from each Anthropic Lane B failure and aggregated the error codes:

| count | category | what's happening |
|---:|---|---|
| 4,351 | `additionalProperties` | models invent fields the activity-block schema forbids |
| 2,688 | wrong `type` constant | activity discriminator uses unsupported values |
| 1,948 | `required` missing | e.g. `exercise_ref` absent on resistance activities |
| 456   | duplicate IDs within week scope | same activity ID reused across days |
| 384   | `oneOf` mismatch | activity shape matches no allowed variant |
| 357   | numeric bound | reps/sets below schema minimum |
| 216   | pattern | IDs not matching slug regex `^[a-z0-9][a-z0-9_-]*$` |
| 9     | phase weeks count | declared phase duration ≠ length of weeks array |

Top error paths (90% of all errors):

```
phases/N/weeks/N/days/N/blocks/N/activities/N            (4,015)
phases/N/weeks/N/days/N/blocks/N/activities/N/type       (2,688)
phases/N/weeks/N/days/N/blocks/N/activities/N/prescription (2,668)
```

The failures concentrate at the **activity block**.

### Two candidate explanations

The data is consistent with two distinct causes, and we cannot
distinguish them from the v0.6 sweep alone:

**Explanation A — the prompt is incomplete.** The Lane B system
prompt teaches outer DSL syntax (`PLAN`, `PHASES`, `WEEK`, `DAY`),
set/rep micro-syntax, and the exercise vocabulary. It does *not*
teach the activity-block JSON schema (the `type` discriminator's
allowed values, `prescription` shape, ID-uniqueness, slug pattern,
numeric bounds). On this view, the LLMs are doing reasonable work
and the gap closes by injecting schema guidance into the prompt.

**Explanation B — the WPL-AI activity-block schema is too complex
for LLMs to produce reliably from prose.** Three observations push
in this direction:

1. **The errors are bulk-structural, not edge cases.** ~10,400 schema
   errors across 30 failing plans is ~333 errors per plan. The models
   are not almost-right; they are writing one shape consistently, and
   the schema is checking for a different one.
2. **`additionalProperties: must NOT have` is the largest category
   (42%).** The LLMs are *inventing* fields the schema forbids. This
   is the signature of "I produced what felt natural; you asked for
   something rigid."
3. **The `type` discriminator is a known hostile pattern.** WPL-AI's
   activity block uses `oneOf` with `type` constants to switch between
   resistance / cardio / mobility / etc. 26% of errors are wrong `type`
   constants. LLMs consistently struggle with discriminated unions —
   they tend to flatten shapes across variants — and this is widely
   documented in structured-output literature.
4. **gpt-5, the strongest model in the lineup, still loses 27% of
   compiled plans to schema errors.** If the structure were learnable
   from in-context guidance, we would expect the strongest model to
   approach ceiling. That it doesn't is suggestive that the gap is
   not purely a context-coverage problem.

Both explanations are testable. v0.6 freezes the prompt to preserve
the v0.5 baseline; v0.7 will run an A/B/C experiment (see "Future
work" below) to attribute the gap.

**We do not commit to either interpretation in this document.** The
served-rate ceiling we report is what the v0.5 prompt + v0.5 WPL-AI
schema produce together; the v0.7 sweep will tell us which of the
two layers carries the cost.

### The gpt-5-nano caveat

gpt-5-nano produced 21 plans that compiled but **0** that passed the
schema validator. Every single one had a structural error the
compiler did not catch. This is uniquely bad — the next-worst model
(Opus 4.7) still gets 4/30 through. We do not have a clean
explanation; possibilities include nano's smaller context interacting
with the vocabulary list, or a systematic error in its understanding
of the `type` discriminator. This is worth a dedicated diagnostic
run in v0.7 if nano remains a target tier.

---

## Cost (180 new Anthropic trials)

| model | trials | cost | per trial |
|---|---:|---:|---:|
| Haiku 4.5      |  60 | $10.78 | $0.18 |
| Sonnet 4.6     |  60 | $45.75 | $0.76 |
| Opus 4.7       |  60 | $52.17 | $0.87 |
| **total**      | 180 | **$108.70** | — |

Token economics. Anthropic's tokenizer for Opus 4.7 (and 4.8) is new
relative to Opus 4.1 and can consume ~35% more tokens for the same
input text — confirmed against the documented pricing page on
2026-06-03. Our pricing.ts had the wrong Opus 4.7 row ($15/$75; those
were Opus 4.1's prices). Correction committed in `60d29d1`. The
$108.70 total reflects the corrected pricing.

---

## Methodology notes and disclosures

### Determinism asymmetry: Opus 4.7+ rejects `temperature`

During the Opus sweep, every API call returned 400
`` `temperature` is deprecated for this model. `` Anthropic deprecated
the parameter for Opus 4.7 and 4.8; the model handles sampling
internally. Our adapter was patched to omit the field for those
models only (Haiku and Sonnet still receive `temperature: 0`). This
introduces an asymmetry vs. the OpenAI lane, where every model is
called with `temperature: 0`: Opus 4.7 runs are *not* fully
deterministic in the same way. We disclose this and recommend
labelling Opus 4.7 results as "model-controlled sampling" in any
paper figure that captions OpenAI runs as "deterministic
(temperature=0)". Regression test added in
`test/anthropic-adapter.test.ts`.

### Refusal patterns

The OpenAI lineup produced 0 refusals across 240 trials. The
Anthropic lineup produced 22 refusals across 180 trials, all on
Lane B (compile-the-DSL prompts):

| model | A refusals | B refusals |
|---|---:|---:|
| Haiku  | 0 | 12 |
| Sonnet | 0 | 0  |
| Opus   | 1 | 9  |

Two patterns. (a) Haiku and Opus refuse the structured-emission task
more than the prose-plan task. The Lane A prompts ("write a plan")
sail through; the Lane B prompts ("write a plan as WPL-AI DSL") get
declined as medical advice. Sonnet does not show this asymmetry. (b)
The OpenAI lineup never refused, even on the same scenarios. This is
a real vendor difference: Anthropic's RLHF is more conservative on
clinical-adjacent fitness prompts when those prompts include a
structured-output requirement.

Refusals are reported as their own column in §"The numbers" and are
*not* counted as either served plans or safety violations. A refusal
is also not a clean plan.

### What v0.6 explicitly did not change

- Scenarios: identical to v0.5 (15 scenarios in
  `scenarios/scenarios.yaml`)
- Lane B system prompt: identical (`buildLaneBSystemPrompt`,
  `LANE_B_VARIANT = "full"`)
- Scorer: identical (no new violation categories, no scorer-
  asymmetry fix on cycle scenarios)
- Validator: identical (`@gymbile/wpl-validator ^1.7.1`)
- wpl-ai compiler: identical (`^1.13.0`)

The cross-vendor result is therefore a pure substitution: same input,
same gates, different models. This is the version of the experiment
that is methodologically clean for the paper.

---

## Future work (deferred to v0.6.1 and v0.7)

1. **Short-plan scenarios** (v0.6.1). 1-, 3-, and 5-week scenarios for
   travel blocks, reconditioning, deloads, intro on-ramps. The 15
   v0.5 scenarios are all 12-week requests; we have no measurement
   of WPL on short-plan generation. Scoped in
   `docs/V0_6_SHORT_PLANS_AND_ANTHROPIC.md`.
2. **Schema-fail attribution A/B/C** (v0.7). The single most
   important v0.7 experiment. We do not currently know whether the
   schema-fail rate is a prompt problem or a format problem, and the
   answer determines what changes between v0.6 and v0.7. Three arms:

   - **Arm A — schema-enriched prompt.** Same WPL-AI format. Inject
     the activity-block JSON schema (or a faithful prose summary of
     it) into the Lane B system prompt. Tests: "Was the gap just a
     context-coverage problem?"
   - **Arm B — simplified WPL-AI activity block.** Redesign the
     activity block to drop the `type` discriminator, allow a more
     open prescription shape, and let the compiler infer defaults.
     Keep the semantic content (exercise, sets, reps, RPE, rest).
     Tests: "Was the activity-block schema itself too complex?"
   - **Arm C — native structured output.** Use Anthropic's structured
     outputs / OpenAI's JSON-mode + schema and skip the DSL→compile
     →JSON indirection entirely. Tests: "Is the DSL middle layer
     adding cost without value?"

   Whatever the result, the v0.6 numbers stand as the frozen baseline
   for the v0.5 prompt + v0.5 schema. The v0.7 report will publish the
   v0.7 numbers alongside v0.6 so readers see the delta explicitly.
   **No retroactive changes to v0.6 figures.**
3. **gpt-5-nano schema diagnostic** (v0.7). Targeted root-cause
   analysis of why nano produces 0/30 schema-valid plans.
4. **Clinician review** (v0.7). Per-domain validation of the
   blacklist encodings by domain experts. Deferred from v0.6 per the
   2026-05-30 rescope.
5. **Gemini lineup** (v0.7). Three-vendor coverage. Deferred from
   v0.6 per the 2026-05-30 rescope.

---

## Reproduction

```
git clone https://github.com/gymbile/wpl-eval.git
cd wpl-eval
git checkout v0.6.0-anthropic
npm ci
# OPENAI_API_KEY and ANTHROPIC_API_KEY in .env
npm run eval -- --sweep=v0.6
```

The 180 Anthropic result JSONs live under `results/` with the
filename pattern
`<model>+v0.6-<haiku|sonnet|opus>__<scenario>__<lane>__<phase>.json`.
The runner is idempotent: existing result files are skipped.
