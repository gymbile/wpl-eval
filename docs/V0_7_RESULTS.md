# v0.7 / v0.7.1 results — honesty hardening, enforcement-in-library, and a production catalog gap

**Status:** 2026-06-19. Branch `wpl-v07-content`. Companion to
[`V0_6_RESULTS.md`](V0_6_RESULTS.md), which remains the source of the
cited corpus numbers. This document records what changed from the
corrected v0.6 baseline through the shipped v0.7 (methodology + enforcement)
and v0.7.1 (canonical exercise catalog) work.

**The one-line summary:** v0.7 ships no new safety percentages. It ships
the engineering and the honesty fixes that make the *next* measurement
trustworthy — and, on the way, it makes the v0.6 Lane B numbers something
we expect to come *down*, not up. v0.7.1 closes a real production safety
gap (a drifted exercise catalog) that the benchmark never saw because it
lived in the live system, not the corpus.

---

## TL;DR

1. **Enforcement moved into the published library.** The `enforce()`
   step — the part that actually strips a contraindicated exercise — used
   to live in the eval harness. It now lives in the published
   `@gymbile/wpl-validator`. The behaviour that production serves and the
   behaviour the benchmark measures are now the same code path.
2. **The benchmark was made less flattering on purpose.** Four honesty
   fixes (de-circularized rules, an independent extractor, a fail-closed
   compiler, and a matcher plural fix) each remove a way the v0.6 numbers
   were quietly flattering the contract. None of them produce a new
   published percentage; together they mean a de-circularized re-run is
   expected to show Lane B numbers *lower* than the v0.6-corrected ones.
3. **No new headline safety percentages.** The full paid re-run under the
   de-circularized methodology has **not** happened. A $0 rescore census
   confirms the frozen corpus is stable under the 2.x library (see
   "What's pending"). Until the re-run, the cited numbers are the
   v0.6-corrected ones.
4. **A production catalog gap was found and closed (v0.7.1).** The
   exercise catalog had drifted across repos; the production fork was
   missing the entire `rehab_mobility` category, so post-injury rehab
   exercises resolved as "unknown" to the live safety layer. Fixed with a
   single canonical catalog (152 names) as the source of truth.

---

## What changed v0.6 → v0.7

All v0.7 items below were **shipped 2026-06-16..18** and the packages are
live (see "Packages" at the end).

### Enforcement is now in the published validator

In v0.6, Lane B applied `enforce(clientContext)` — strip the
contraindicated exercises against the client's constraints — inside the
eval harness. That made the benchmark honest about *the rule engine's*
behaviour but left a gap: a downstream consumer of the published package
had to re-implement enforcement to get the same protection.

v0.7 moves `enforce()` into `@gymbile/wpl-validator` itself. The
benchmark now calls the same published code a production consumer would,
so "what the eval measures" and "what a consumer gets" are no longer two
implementations that can drift apart.

### The compiler fails closed on safety paths

Previously a typo'd safety section could be silently dropped — the
compiler would proceed and the safety rule it described would simply not
fire. v0.7 makes the safety paths **fail closed**: a malformed safety
section is now a hard compile error, not a silent delete. A safety rule
you can't parse is treated as a safety rule you can't honour.

### Repairs ledger

Every silent normalization the model's output went through on the way to
a served plan (fence stripping, ID canonicalization, defaulting) is now
recorded in a repairs ledger for a human reviewer, rather than being
applied invisibly. The contract still repairs what it can repair; it no
longer hides that it did so.

### De-circularization of the Lane B rules

This is the most consequential honesty fix. In v0.6 the Lane B "rules a
trainer would configure" had been derived from the **same blacklist used
for grading**. The filter, in effect, had the answer key: it was being
graded against the criteria it was built from. v0.7 re-authors those
rules from the **client's clinical picture**, independent of the grading
key. In one scenario this flipped a near-zero violation count to **7** —
and the 7 is the honest number. The general consequence: a
de-circularized re-run is expected to report Lane B numbers *higher* in
absolute violations (i.e. the reduction looks *smaller*) than the
partially-circular v0.6 measurement did.

### Independent extractor

In v0.6 each model extracted its own Lane A output, which produced a
perverse artifact: more capable models, which write more elaborate prose,
gave their own extractor more to find — so capability made a model look
*less* safe partly as a measurement effect. v0.7 uses **one fixed
extractor model for every trial**, so the Lane A extraction step is no
longer entangled with the model under test.

### Honest disclosure + matcher plural fix

- Only **3 of 7** models accept a `temperature` setting; the rest use
  model-controlled sampling. v0.7 stops implying a uniform deterministic
  setup and discloses the asymmetry, adds confidence intervals, and
  rewrites the docs to match the code.
- The blacklist matcher undercounted: `push_ups` slipped past a
  `push_up` rule. The plural gap is fixed, which means the old matcher
  was **failing open** — another reason the corrected re-run is expected
  to show more violations, not fewer, on the raw lane.

---

## What's superseded

- **The retracted "0 violations" / "0 of 60" / "0/180" Lane B figures.**
  These were the v0.6 plan-walker measurement bug, already retracted in
  `V0_6_RESULTS.md`. They are not live statistics and must never be cited
  as such.
- **The partially-circular Lane B numbers as an *upper bound* on the
  contract's strength.** The v0.6-corrected Lane B figures (8–17% unsafe;
  3–5× reduction) remain the cited corpus, but they were measured with
  rules partly derived from the grading key and a matcher that failed
  open. The honest expectation is that a de-circularized, fixed-matcher
  re-run shows the contract is **somewhat less effective** in absolute
  terms than the v0.6 numbers suggest. We flag this rather than wait for
  the re-run to surface it.

---

## What's pending

- **The full de-circularized re-run.** A paid re-run of the corpus under
  the v0.7 methodology has **not** been done. Therefore there are **no
  new headline safety percentages** in this document. When the re-run
  happens, the Lane B numbers are expected to be smaller (less favourable
  to the contract) than the v0.6-corrected baseline, for the
  de-circularization and matcher reasons above.
- **$0 rescore census (done, and reassuring).** Every frozen Lane B trial
  was re-scored under the 2.x library with no new API calls: **0 of 269**
  frozen Lane B trials fail-closed under the new library. The frozen
  corpus numbers are stable — the library change did not retroactively
  break or shift the committed results. This is a stability check, not a
  re-run; it does not produce a new percentage.

---

## v0.7.1 — the production catalog gap (and its closure)

Shipped to production **2026-06-18**. Unlike everything above, this gap
never appeared in the benchmark — it lived in the live system.

### The symptom

A whole class of clients — people coming back from injury — had rehab
exercises (`scapular_retraction`, `external_rotation`, `pelvic_tilt`,
`diaphragmatic_breathing`, …) that the **production** compiler / safety
layer resolved as "unknown." A safety layer can only govern a vocabulary
it shares; an exercise it doesn't know exists, it can't strip or reason
about.

### The root cause

The exercise catalog (the vocabulary of known exercises) had been copied
across ~7 repos with no sync, and had drifted. Gymbile's in-house
production fork was missing the **entire `rehab_mobility` category** plus
`inverted_row` and `hangboard` — **10 names** in total.

### Why it's a safety bug, not a code smell

Governance acts on a shared vocabulary. The rules were correct; the
catalog the production layer used to interpret plans against them was
incomplete. The drift wasn't cosmetic — it silently narrowed what the
safety layer could see.

### The fix

One canonical catalog (**152 names**) in the `wpl` spec repo as the
**single source of truth**. Every consumer vendors a pinned copy and
generates its native module via deterministic codegen, guarded by CI
drift-checks (vendored-JSON-matches-the-pinned-release, and
re-run-codegen-produces-no-diff). The backend regained the 10 names with
a regression test asserting they are now known, plus an end-to-end test
that a plan containing a rehab exercise compiles. Deployed to production.

The class is closed; the drift-checks are what stop the next one.

---

## Packages

| | version |
|---|---|
| npm `@gymbile/wpl-validator` | **1.9.0** |
| npm `@gymbile/wpl-ai` | **2.1.0** |
| Hex `wpl_validator` | **1.9.0** |
| Hex `wpl_ai` | **2.1.0** |
| spec tag (`wpl` repo) | **v1.8.0** |

---

## Honest non-claims

- **No clinician validation.** Neither the blacklist encodings, the
  short-plan structural thresholds, nor the canonical catalog have been
  validated by clinicians reviewing the corpus. Entries cite published
  sources; the encoding is the Gymbile team's. The relative comparison
  (raw LLM vs WPL) is robust to this; the absolute labels are not yet
  externally signed off.
- **No new safety percentage.** This document deliberately publishes no
  new headline rate. The de-circularized re-run is the budgeted next step.
- **The catalog SSOT is names only.** A canonical **alias table** and a
  single source of truth for **contraindication data** are future phases,
  not part of v0.7.1.
