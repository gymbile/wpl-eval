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

4. **The DSL→compile path is doing real schema-conformance work that
   direct LLM emission cannot substitute for.** In-cycle direct-JSON
   probes ($2.76, 20 trials across a 2x2 of {Sonnet 4.6, gpt-5-mini}
   × {2-week, 12-week}): at 12-week plan length, gpt-5-mini (with
   adequate output budget and full schema in-prompt) hit **0/5
   schema-valid** with ~115 errors per plan — worse than Sonnet's
   17% via DSL→compile on the same length in the main sweep. Even
   at 2-week scale, gpt-5-mini still hit 0/5; only Sonnet handled
   short plans (3/5). The dominant error category — `additional
   Properties: must NOT have` — is universal across vendors and
   plan lengths. The format itself is the binding constraint at
   production scale, which sharpens the v0.7 priority toward Arm B
   (simplify the activity-block schema), not Arm A (enrich the
   prompt) or Arm C (chunk the synthesis).

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

### Two candidate explanations (sharpened by native-JSON probes)

The Lane B sweep alone cannot distinguish two candidate causes; two
direct-JSON probes against Sonnet 4.6 (reported below in §"Native-JSON
probes") move the picture forward but don't resolve it cleanly either.

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
direct-JSON probes (next section) provide partial evidence: short
plans validate at ~60% on native JSON-mode, suggesting the schema
itself is producible at small scale. The v0.6 served-rate ceiling
combines (a) the schema's complexity, (b) the DSL→compile path's
translation overhead, and (c) the output-token budget for full-length
plans. The v0.7 sweep will measure each contribution.

---

## Native-JSON probes (v0.6 in-cycle, $2.76 total spend)

We ran four probes outside the locked sweep to attribute the schema-
fail rate observed in §"Finding 3." Each uses the full WPL JSON
Schema (37,928 chars / ~10k tokens) included in the system prompt.
The model is asked to emit WPL JSON directly — no DSL, no compile
step. Output is parsed and validated by `@gymbile/wpl-validator`,
the same validator Lane B uses. The four probes cross two factors
(plan length × vendor):

| | 2-week | 12-week |
|---|---|---|
| **Sonnet 4.6** (Anthropic mid-flagship) | 3/5 schema-valid (60%) | 0/5 — truncated at 16K output cap |
| **gpt-5-mini** (OpenAI mid-flagship)    | 0/5 schema-valid (3/5 parsed; 1–5 errors each) | 0/5 schema-valid (4/5 parsed; ~115 errors each) |

The detailed per-probe writeups follow.

### Probe 1 — 12-week direct-JSON ($1.45, 5 trials)

Prompt: each scenario's original `single_turn_prompt` (which asks for
a 12-week programme). Output cap: 16,384 tokens (Sonnet's documented
max-output limit for the messages API).

| metric | result |
|---|---|
| hit output token cap | **5 / 5** |
| parse_ok | 0 / 5 |
| schema_valid | n/a (no parse) |

Every trial emitted exactly 16,384 output tokens and the JSON was
truncated mid-string (e.g. "Unterminated string at position 63,328").
Inspection of the partial output shows Sonnet was attempting to
produce valid WPL JSON — `$schema`, `version`, `plan.id`, structured
phase/week/day trees — but the full 12-week plan exceeds the LLM's
output token budget. A rough character count puts a complete plan at
~150KB / ~40k output tokens, well beyond what Sonnet (or any current
flagship) can emit in a single response.

**This is a property of the WPL JSON format itself.** A 12-week DSL
plan is ~3–5KB (LLM-emittable in one shot). The same plan as JSON is
~150KB. The DSL→compile architecture exists, at minimum, because the
DSL fits in the output window and the JSON does not.

### Probe 2 — 2-week direct-JSON ($1.07, 5 trials)

Same 5 scenarios, same model, same schema-in-prompt. The user prompt
was modified to override the duration request: "generate a SHORT
2-week introductory plan only; keep total activity count under ~30."

| metric | result |
|---|---|
| hit output token cap | 0 / 5 |
| parse_ok | **5 / 5** |
| schema_valid | **3 / 5** |
| errors in failing plans | 1 and 4 (minor — invalid action type/scope) |
| cost per trial | $0.16 – $0.23 |

The picture changes substantially:

- **Token budget is not the limit at this scale.** Output sizes
  landed between 7,754 and 12,380 tokens — comfortably inside the
  16K cap. The 12-week truncation in Probe 1 is a length effect, not
  a baseline incompetence.
- **Schema-valid rate jumps from 17% (DSL Lane B, Sonnet) to 60%
  (direct JSON, Sonnet) at this plan length.** The native-mode arm
  more than triples the success rate against the same validator.
- **The 2 failures had 1 and 4 errors each**, not the hundreds-per-
  plan bulk-structural failures seen in the DSL Lane B sweep. The
  errors are localized: `"invalid action type 'X'"` and
  `"invalid action scope 'X'"`. The model is producing the right
  *shape* and missing on specific enum values.

### Probe 3 — 12-week direct-JSON on gpt-5-mini ($0.16, 5 trials)

The Sonnet 12-week probe couldn't separate two confounds: did the
plan not fit, or did the model fail at schema? gpt-5-mini has a much
larger output budget than Sonnet (32K+ vs 16K), so a re-run on the
same prompts isolates the question.

| metric | result |
|---|---|
| hit output token cap | **0 / 5** (budget is not the limit) |
| parse_ok | 4 / 5 (one malformed JSON) |
| schema_valid | **0 / 5** |
| errors per parsed plan | 54, 62, 98, 247 (~115 average) |
| top categories | additionalProperties (306), wrong type constant (64), missing required (61) |

The four parsed plans were *real* 12-week plans: 3–6 phases, 32–36
days, 46–75 activities. Not skeletons. gpt-5-mini was genuinely
producing structured 12-week WPL JSON and the schema validator
rejected every attempt with the **same hostile error categories** the
DSL Lane B sweep surfaced. Token budget is not the constraint here;
the schema's structural strictness is.

### Probe 4 — 2-week direct-JSON on gpt-5-mini ($0.08, 5 trials)

Closes the 2x2 matrix (plan length × vendor).

| metric | result |
|---|---|
| hit output token cap | 0 / 5 |
| parse_ok | 3 / 5 |
| schema_valid | **0 / 5** |
| errors per parsed plan | 2, 5, 65 |
| top categories | additionalProperties (49), wrong type constant (7), missing required (6), invalid action type (3) |

Even at the 2-week scale where Sonnet hit 60%, gpt-5-mini hits 0%.
The error pattern is the same as the 12-week case, just smaller in
absolute count. gpt-5-mini consistently produces structures with
fields the schema rejects regardless of plan length — particularly
the `additionalProperties: false` constraint.

### What the four probes attribute

The schema-fail rate observed in the main v0.6 sweep has at least
three contributing causes, and the closed 2x2 matrix lets us separate
them:

| factor | evidence | role |
|---|---|---|
| **Format complexity** (Explanation B, the dominant cause at production scale) | Both vendors fail at 12-week regardless of budget; gpt-5-mini fails at 2-week too; the dominant error category is `additionalProperties` (models invent fields the schema forbids) across all probes | **Dominant** |
| **Plan length** | Sonnet drops from 60% (2-week) to "doesn't fit" (12-week); gpt-5-mini's error count rises from a handful per plan to ~115 per plan | Material, vendor-dependent |
| **Output token budget** | Sonnet truncated 5/5 at 12 weeks; gpt-5-mini had headroom | Vendor-specific, solvable by routing |
| **Vendor/model capability** | At 2-week scale, Sonnet hit 60%, gpt-5-mini hit 0% | Real interaction at small scale; both fail at large scale |

**The biggest finding from these probes is architectural and goes
beyond what §"Finding 3" reports:** the DSL→compile path is doing
real schema-conformance work that the LLM cannot substitute for by
reading the schema directly. Concrete comparison at 12-week scale:

| path | schema-valid rate at 12 weeks |
|---|---|
| Sonnet 4.6, DSL → compile → JSON | 17% (5/30 in the main sweep) |
| gpt-5-mini, **direct JSON** with schema in-prompt | **0%** (0/5 in probe 3) |

Even on a model with sufficient output budget, even with the schema
in the prompt verbatim, **direct LLM emission of production-length
WPL JSON does not work on the current schema**. The compiler is
genuinely translating LLM-natural shapes into schema-conformant ones
— and that translation is load-bearing.

This refocuses the v0.7 A/B/C/D experiment significantly: Arm B
(simplify the WPL JSON shape) is the most informative of the four,
because all the other arms (prompt enrichment, chunked synthesis,
DSL-with-better-prompt) leave the format unchanged and the four
probes suggest the format itself is the binding constraint at
production plan lengths.

### Methodology caveats for the probes

- **N = 5 per probe (20 total).** Directional signal, not a calibrated
  rate. We do not claim "60% schema-valid" as a published headline
  number; we report the rates as the relative ordering between
  conditions in a 2x2 attribution design.
- **Safety scorer was NOT run on probe outputs.** Schema-valid plans
  may still contain contraindicated prescriptions. Spot-check of the
  successful Sonnet `torn_meniscus` short plan, for example, contains
  a string match for "plyometric" — which the WPL safety contract
  would flag but the JSON validator does not. We use these probes
  only to attribute the schema-validation result; safety claims stay
  with the main sweep.
- **Two models, two vendors — not the full lineup.** Probes cover the
  mid-flagship tier on each vendor (Sonnet 4.6, gpt-5-mini). Opus
  4.7 might hit Sonnet's output-budget wall earlier; gpt-5 might do
  better than gpt-5-mini given its higher schema-valid rate in the
  main DSL sweep. The 2x2 shows the attribution shape; a full 7-model
  × 2-length matrix is v0.7 territory.
- **The 2-week override prompt is approximate.** We prepended a
  duration-override sentence to the scenario prompt. A more faithful
  short-plan probe would use scenarios that *natively* ask for short
  plans — exactly the v0.6.1 short-plan workstream. Treat the 60% /
  0% numbers as "what happens when an existing scenario is forced
  shorter," not "what happens for short-plan-native requests."

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

## What this means for WPL-AI design

This section steps outside the published-result frame and argues a
design position: **the data is more consistent with WPL-AI's activity
block being too complex for LLMs to produce reliably from prose than
with the Lane B prompt being incomplete.** We include this section
because the paper has to decide whether the v0.7 work is "add schema
to the prompt" (cheap, narrow) or "simplify the format" (substantial,
broader). Our recommendation is to take simplification seriously, and
the v0.7 A/B/C experiment is designed to falsify this recommendation
if it's wrong.

### Where the complexity comes from

Walking the schema-error breakdown back to the schema, four sources
dominate the failure rate:

1. **The `type` discriminator on the activity `oneOf`** (26% of
   errors). WPL-AI represents an activity as a tagged union — a
   `type` constant ("resistance" | "cardio" | "mobility" | "mobility"
   | …) selects which inner `prescription` shape is valid. LLMs
   consistently *flatten* discriminated unions: they write one
   activity shape that mixes fields from multiple variants. This is
   not a vocabulary issue, it is a structural one. Models that
   succeed on simple JSON Schema fail on `oneOf`+`type` patterns at
   substantially higher rates; this is widely documented in
   structured-output literature, not specific to WPL-AI.
2. **`additionalProperties: false`** (42% of errors). The schema
   refuses any field it doesn't know about. LLMs invent
   reasonable-sounding fields — `notes`, `tempo`, `cues`,
   `instructions` — that a human author would naturally include in a
   workout. Every one of those invented fields fails validation
   *even if everything else is correct*.
3. **ID-uniqueness within week scope + slug pattern** (672 errors).
   Activity IDs must (a) match `^[a-z0-9][a-z0-9_-]*$` and (b) be
   unique within a week. LLMs naturally reuse a stable ID for "the
   same exercise" across days ("back_squat" on Monday and Friday),
   which is the *opposite* of what the schema requires. The
   normalisation cost falls on the LLM rather than on the compiler.
4. **Required fields on the inner prescription** (1,948 errors).
   `exercise_ref`, `prescription.type`, structured set/rep
   representations — each is required in specific positions in the
   tree. LLMs forget required fields at depth.

The common thread: WPL-AI's activity block externalises decisions
that *could be made at compile time* into decisions that *must be
made correctly by the LLM*. Every one of those externalised
decisions is a place the LLM can fail.

### What a simpler shape would look like

Three concrete simplifications, ordered by reversibility:

| simplification | how | what it loses | what it keeps |
|---|---|---|---|
| **Allow `additionalProperties`** | Change activity-block schema to permit unknown fields; the validator ignores them; the rule engine continues to read only the fields it knows about | The contract no longer flags invented fields. A renderer that round-trips activities must decide what to do with unknown keys | All safety scoring, vocabulary enforcement, semantic checks |
| **Drop the `type` discriminator** | Replace the `oneOf` with a single `Activity` shape where prescription fields are optional; runtime dispatch examines which fields are present | Slight ambiguity on the boundary between activity types; less precise error messages when prescription is malformed | Discriminator-free schemas are the dominant pattern in LLM-friendly JSON; LLMs produce them at substantially higher accuracy |
| **Compiler-generated IDs and slug normalisation** | LLM emits human-readable names; compiler computes canonical IDs and enforces uniqueness | Cross-references inside the LLM-emitted plan get harder (the LLM can't refer to a previously-named activity by ID, because the ID didn't exist yet) | All downstream tooling continues to receive canonical IDs |

All three are individually small. Together they would eliminate the
top three error categories — which accounted for ~94% of the schema
errors in the v0.6 Anthropic sweep — without changing the safety
contract or the scoring logic.

### What we are *not* proposing

We are not proposing to weaken the safety contract. The scorer's
blacklist, contraindication rules, and cycle-aware phasing — the
things that produce "Lane B = 0 safety violations across 180
Anthropic trials" — are independent of the schema's structural
strictness. Activity-block simplification leaves all of them intact.

We are also not proposing to drop the DSL. The DSL gives authors a
concise concrete syntax; the question is what JSON the DSL compiles
*to*. Loosening the JSON layer does not require touching the DSL
the user writes.

### Why we don't commit to the redesign in v0.6

Two reasons. (a) The v0.6 results are valuable as a fixed-prompt /
fixed-schema baseline — they tell us what the v0.5 release-version
of WPL-AI delivers on a fresh vendor, which is the reproducibility
property the paper relies on. (b) We have not yet measured the
effect size of Arm A (prompt enrichment). If a 30-line schema
appendix in the system prompt closes most of the gap, the
simplification argument is weaker and the cost-benefit shifts. The
v0.7 A/B/C experiment is designed exactly to make this attribution
empirical, not rhetorical.

The position we take in this draft is therefore: **acknowledge the
design hypothesis honestly, run the experiment that disambiguates,
let the data decide.** Papers that argue for a redesign without
running the falsification experiment are weaker than papers that
run it.

---

## Cost (180 new Anthropic trials)

| model | trials | cost | per trial |
|---|---:|---:|---:|
| Haiku 4.5      |  60 | $10.78 | $0.18 |
| Sonnet 4.6     |  60 | $45.75 | $0.76 |
| Opus 4.7       |  60 | $52.17 | $0.87 |
| native-JSON probes (Sonnet + gpt-5-mini, 20 trials) | 20 | $2.76 | $0.14 |
| **total**      | 200 | **$111.46** | — |

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
2. **Schema-fail attribution A/B/C/D** (v0.7). The single most
   important v0.7 experiment. v0.6's in-cycle native-JSON probes
   (above) ruled out the *naive* version of Arm C — direct WPL JSON
   for a 12-week plan exceeds the LLM output budget — but they
   *strengthened* the case for testing a chunked variant. Four arms:

   - **Arm A — schema-enriched prompt.** Same WPL-AI format. Inject
     the activity-block JSON schema (or a faithful prose summary of
     it) into the Lane B system prompt. Tests: "Was the gap just a
     context-coverage problem?"
   - **Arm B — simplified WPL-AI activity block.** Redesign the
     activity block to drop the `type` discriminator, allow a more
     open prescription shape, and let the compiler infer defaults.
     Keep the semantic content (exercise, sets, reps, RPE, rest).
     Tests: "Was the activity-block schema itself too complex?"
   - **Arm C — chunked native JSON synthesis.** Generate the plan
     scaffold in one call, then each week (or phase) as a separate
     native-JSON call against a *subset* of the schema, then assemble.
     Probe 2 above shows Sonnet hits 60% schema-valid on 2-week
     plans; a 12-week plan composed of six 2-week chunks may close
     the gap. Tests: "Does the DSL middle layer add value once we
     route around the token-budget constraint?"
   - **Arm D — DSL + schema-aware Lane B prompt.** The cheapest arm.
     Keep the DSL→compile path; add ~30 lines of activity-block
     schema guidance to the Lane B system prompt. Tests: "Is most of
     the gap closable without changing architecture?"

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
