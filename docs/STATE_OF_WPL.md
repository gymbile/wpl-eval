# The State of WPL — Governed AI for Wellness & Fitness

**Date:** 2026-07-21 · **Eval version:** v0.7.0 · **All numbers below are
from the open, reproducible benchmark in this repository.**

---

## The problem

Generative AI writes fitness and wellness programmes fluently — and
unsafely. When a client has a contraindication (a torn meniscus, a recent
C-section, a cardiac rehab protocol), a raw LLM asked for a training plan
will prescribe contraindicated work in **32–51% of trials**, depending on
the model. The failure is worse than it looks in a demo, for three
measured reasons:

1. **It compounds over a conversation.** Constraints stated at turn 1
   drift out of the plan by turn 6–8.
2. **It does not improve with model quality.** The most capable models on
   the market are among the *worst* raw-safety performers — flagships
   prescribe more contraindicated work than budget models, across
   vendors. Buying a better model does not buy safety.
3. **It breaks hardest when the client changes.** Real clients get
   injured mid-programme, get cleared, travel, regress. When state
   changes mid-conversation, 9 of 10 raw models fail to *remove* what
   they already prescribed.

## What WPL is

**WPL (Wellness Plan Language)** is an open governance layer between the
LLM and the client. The model does not hand free text to a human; it
emits a strict domain-specific language that is **compiled, schema-
validated, and rule-enforced** before anything is served:

```
LLM → WPL-AI DSL → compiler → schema validator → rule engine (enforce) → served plan
```

The rule engine consumes a structured client profile (`ClientContext`) —
injuries, equipment, cardiac phase, menstrual-cycle pattern, clearances —
and deterministically strips anything the client's rules forbid, per day,
per week. It re-fires on every regeneration, so when the client's state
changes, the served plan changes with it. The plan the client receives is
a validated artifact, not model prose.

## The evidence

The benchmark runs every scenario in two lanes on the same model: **Lane
A** (raw LLM, free text) and **Lane B** (same LLM, through the WPL
pipeline). Three properties are measured, all cross-vendor.

### 1. Safety — static contraindications

20 clinically-grounded client scenarios (orthopedic, postpartum, cardiac,
metabolic, cycle-related), single-turn and 8-turn conversations, OpenAI +
Anthropic lineups.

| | Raw LLM | LLM + WPL |
|---|---|---|
| Trials serving unsafe prescriptions | **32–51%** | **8–17%** |
| Reduction | — | **3–5×, every corpus, every phase** |
| Multi-turn constraint drift | 42% of conversations | 6% (0% on Anthropic models) |

### 2. Structure — programme quality gates

Short-plan corpus (1–4 week blocks: maintenance, peaking, on-ramp,
reconditioning, deload). The compiled-plan pipeline lets deterministic
rules check properties free text cannot expose: deload volume, weekly
progression caps, rest-day floors, forbidden outcome promises. The raw
lane is structurally blind to this entire failure class.

### 3. Adaptability — evolving clients (new, v0.7.0)

Five lifecycle scenarios: a hamstring strain mid-programme with staged
clearance; a postpartum clearance gate; a travel equipment window; cardiac
phase progression *and regression*; an irregular-to-regular cycle
transition. 100 multi-turn trials, **10 models, 3 vendors** (OpenAI,
Anthropic, Google).

| | Raw LLM | LLM + WPL |
|---|---|---|
| State-conditional safety violations | **210** | **10** (**21×** fewer) |
| Pass rate on per-state criteria | 65% | **94%** |
| Clean trials | 46% | 84% |

Standout results:

- **Removal is the raw-LLM blind spot WPL closes completely.** 9/10 raw
  models kept prescribing posterior-chain loading after an injury was
  reported; 9/10 kept barbell work during a hotel-gym travel window.
  Under WPL: 10/10 models pass both — the rule engine strips forbidden
  work regardless of what the model writes.
- **Regression handled.** When a cardiac client's constraints re-tighten,
  WPL re-applies them; raw models across all three vendors leak.
- **Model-independence.** Governed performance is nearly flat from the
  most expensive flagship to the cheapest tier. WPL converts model choice
  from a safety decision into a cost decision.

## Why the numbers are credible

Benchmarks in this space are routinely gamed. This one is built to be
audited instead:

- **Open and reproducible.** Scenarios, scoring code, raw per-trial
  artifacts (including verbatim model output) and rerun instructions are
  public. Anyone with API keys can reproduce the sweep (~$60).
- **De-circularized.** The enforcement the eval tests is the *shipped
  library* (`enforce()` from the published validator package), not
  eval-side code; scenario rules are authored independently of the
  grading key; one fixed extractor model scores every Lane A trial.
- **Fail-loud.** Misconfigured scenarios throw before any API call; a
  compile that silently extracts nothing is a test failure, not a good
  number.
- **Errors are published, including our own.** A v0.6 measurement bug
  ("0/180 violations") was publicly retracted and corrected; the
  corrected, less flattering numbers are the ones cited here.
- **Residual gaps are quantified, not hidden.** WPL is not perfect: 8–17%
  of governed static trials still violate; governance strips but cannot
  force progression (8 of 10 residual lifecycle violations are "cleared
  exercise never re-introduced"); rules do not yet cap intensity (RPE),
  and the eval measured exactly one flagship exploiting that. Each gap is
  a numbered roadmap item, not a footnote.

## Production status

- **Live in production** at Gymbile: generation-time enforcement (prompt
  forbid → retry → fail-closed floor) runs on every AI-generated plan.
- **Published packages:** `@gymbile/wpl-validator` / `@gymbile/wpl-ai`
  (npm) and `wpl_validator` / `wpl_ai` (Hex, Elixir) — TypeScript and
  Elixir runtimes with a shared canonical exercise catalog, CI
  drift-checked against the spec (`wpl` v1.8.0).
- **Spec + eval + site:** open specification, this benchmark, wpl.dev.

## What's next (v0.8)

| Item | Status |
|---|---|
| Intensity capping (`cap_rpe` rule action) | scoped from a measured Lane B miss |
| Deload / detraining volume-delta check | scoped; deferred rather than shipped with a flawed metric |
| Clinician review of the scenario corpus | scheduled; `[VERIFY]` markers published in the interim |
| Repeats + confidence intervals on lifecycle sweep | runner support shipped (Wilson CIs); budget decision |

## One-paragraph summary

Across three vendors and up to ten models, ungoverned LLMs produce unsafe
wellness programming in a third to a half of trials, get worse as the
client's situation evolves, and do not get safer as models get bigger.
The same models routed through WPL's compile-validate-enforce pipeline
cut unsafe output 3–5× on static safety and 21× on evolving-client
safety, with performance nearly independent of which model — or vendor —
is underneath. The remaining gaps are measured, published, and scheduled.
Safety in this category is a property of the governance layer, not the
model.
