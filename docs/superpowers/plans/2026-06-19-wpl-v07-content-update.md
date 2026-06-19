# WPL v0.7 / v0.7.1 Content Update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This is a CONTENT plan — "verification" means build/lint gates + fact-check greps against the spec's honesty floor, not unit tests.

**Goal:** Extend the public "WPL Safety Evals" content (alexfilatov.com blog series, a 2-post LinkedIn series, and supporting docs) to cover v0.7 (shipped honesty/enforcement work) and v0.7.1 (shipped catalog SSOT that closed a production safety gap), without violating the series' honesty standard.

**Architecture:** Three repos, one content branch each (`wpl-v07-content`). alexfilatov.com gets 2 new MDX posts + targeted refreshes of 6. wpl-eval gets README + a new results doc. gymbile_backend gets 2 final LinkedIn drafts + press refresh + draft-collection tidy. A shared fact base + voice live in the spec; a final pass enforces cross-link + no-superseded-number consistency.

**Tech Stack:** MDX (Next.js 16 / Once UI), Markdown, git.

**Authoritative spec (READ FIRST, every task):** `wpl-eval/docs/superpowers/specs/2026-06-19-wpl-v07-content-update-design.md` — §1 voice, §2 fact base (the honesty floor), §3 per-artifact outlines, §4 constraints.

---

## Execution rules

1. **Branches:** `wpl-v07-content` in each repo. alexfilatov.com off `main`; wpl-eval already on `wpl-v07-content` (spec committed there); gymbile_backend off `master`; **wpl spec repo off `main`** (`/Users/alex/Projects/my/gymbile.com/wpl`). Never work on default branches.
2. **Never** invent a safety percentage, never reuse the retracted "0 violations"/"0 of 60" as a live stat, never claim a corpus re-run happened. Every number must trace to spec §2.
3. **Do not** publish to LinkedIn, deploy alexfilatov.com, or push, without explicit user approval. Local commits only.
4. **Never** modify `wpl-eval/results/` or frozen corpus data.
5. Commits: conventional, NO AI/Claude/Anthropic attribution.
6. Voice: first person, data-forward, honest, no hype/emoji in blog bodies (spec §1).
7. Cover images for the 2 new posts: reference `cover.jpg` at the standard path but DO NOT generate art — leave the path; Alex supplies the image.

---

## File Structure

| Repo / path | New/Mod | Responsibility |
|---|---|---|
| `alexfilatov.com/src/app/blog/posts/wpl-auditing-your-own-safety-evals.mdx` | new | Blog A — v0.7 credibility post |
| `alexfilatov.com/src/app/blog/posts/wpl-production-safety-blind-spot.mdx` | new | Blog B — v0.7.1 production-gap post |
| `alexfilatov.com/src/app/blog/posts/two-lane-llm-safety-benchmark.mdx` | mod | fix stale 0/60 + footer |
| `alexfilatov.com/src/app/blog/posts/llm-fitness-plans-dangerous.mdx` | mod | forward-note + footer |
| `alexfilatov.com/src/app/blog/posts/multi-turn-llm-drift.mdx` | mod | forward-note + footer |
| `alexfilatov.com/src/app/blog/posts/compile-time-safety-contract-llm.mdx` | mod | footer link |
| `alexfilatov.com/src/app/blog/posts/bigger-llms-arent-safer.mdx` | mod | footer link |
| `alexfilatov.com/src/app/blog/posts/llm-indentation-end-markers.mdx` | mod | footer link |
| `wpl-eval/README.md` | mod | "why WPL" intro paragraph (E2) + v0.7/v0.7.1 status + version pins (B1) |
| `wpl/README.md` | mod | "why WPL" intro paragraph with verified eval numbers (E1) |
| `wpl-eval/docs/V0_7_RESULTS.md` | new | v0.6→v0.7→v0.7.1 changelog/results |
| `gymbile_backend/wpl_v0.7_post.md` | mod | update stale guardrails (shipped) — source for Blog A + LI#1 |
| `gymbile_backend/wpl_v0.7.1_post.md` | new | v0.7.1 long-form + LI#2 source |
| `gymbile_backend/wpl_linkedin_post.md` etc. | mod/move | tidy: archive superseded LI v1–v3 |
| `gymbile_backend/wpl_press_kit.md`, `wpl_press_outreach.md` | mod | v0.7.1 status refresh |

---

## Task Group A — alexfilatov.com blog

> Branch `wpl-v07-content` off `main` in `/Users/alex/Projects/my/alexfilatov.com`.
> Gate for any MDX change: `npm run build` must succeed (compiles MDX + frontmatter). If build is too slow/flaky locally, fall back to `npm run lint` plus a frontmatter sanity check, and note it.

### Task A1 — Blog A: v0.7 credibility post

**Files:** Create `src/app/blog/posts/wpl-auditing-your-own-safety-evals.mdx`. Source material: `gymbile_backend/wpl_v0.7_post.md` (long-form section).

- [ ] **Step 1: Create branch.** `git -C /Users/alex/Projects/my/alexfilatov.com checkout -b wpl-v07-content main`
- [ ] **Step 2: Write the post.** Adapt the long-form draft from `gymbile_backend/wpl_v0.7_post.md`. Frontmatter:
  ```yaml
  ---
  title: "I Audited My Own AI-Safety Benchmark and Made the Numbers Look Worse"
  publishedAt: "2026-06-23"
  summary: "A safety benchmark you can't trust is worse than no benchmark. So I audited mine instead of marketing it — and found three ways it was flattering me: rules derived from the grading key, models grading themselves, and a matcher that quietly failed open. Here's what I fixed, and why the honest version is more modest."
  tag: "WPL Safety Evals"
  image: "/images/blog/wpl-evals/wpl-auditing-your-own-safety-evals/cover.jpg"
  ---
  ```
  Body beats (spec §3.1 + §2): (1) the three honesty fixes — de-circularized rules (one scenario ~0→7), independent fixed extractor, temperature/matcher honesty (3 of 7 models accept temperature; `push_ups` slipped past `push_up`); (2) the engineering that makes the promise real — enforcement moved INTO the **published** library, compiler fails closed, repairs ledger, the pinned guarantee test; (3) the honest coda — no new headline %; a de-circularized re-run is the next budgeted step and the numbers are expected to come down. **Update the draft's stale guardrails:** v0.7 is SHIPPED — say enforcement now lives in `@gymbile/wpl-validator@1.9.0` (npm) / `wpl_validator 1.9.0` (Hex), not "rolling out". End with a one-line pointer to Blog B (the production-gap story).
- [ ] **Step 3: Fact-check.** Confirm against spec §2: no new safety %; the only Lane-B figure cited is the de-circularization example (~0→7) framed as honest; versions are 1.9.0/2.1.0. Grep the file: `grep -niE "0 violations|0 of 60|rolling out|pending publish" src/app/blog/posts/wpl-auditing-your-own-safety-evals.mdx` → must return nothing (no retracted stats / stale "not shipped" language).
- [ ] **Step 4: Build.** `npm run build` → succeeds; the new post compiles.
- [ ] **Step 5: Commit.** `git add src/app/blog/posts/wpl-auditing-your-own-safety-evals.mdx && git commit -m "blog: add WPL v0.7 honesty-audit post"`

### Task A2 — Blog B: v0.7.1 production-gap post

**Files:** Create `src/app/blog/posts/wpl-production-safety-blind-spot.mdx`.

- [ ] **Step 1: Write the post.** Frontmatter:
  ```yaml
  ---
  title: "My Safety Layer Had a Blind Spot in Production"
  publishedAt: "2026-06-25"
  summary: "A whole class of clients — people coming back from injury — had rehab exercises the live safety layer treated as 'unknown'. Not because the rules were wrong, but because the exercise catalog had quietly drifted across the codebase. A safety layer can only govern a vocabulary it shares. Here's the drift, why it's a safety bug and not a code smell, and the single-source-of-truth fix that shipped."
  tag: "WPL Safety Evals"
  image: "/images/blog/wpl-evals/wpl-production-safety-blind-spot/cover.jpg"
  ---
  ```
  Body beats (spec §3.2 + §2): (1) symptom — post-injury rehab exercises (`scapular_retraction`, `diaphragmatic_breathing`, …) resolved as "unknown" to the production compiler; (2) root cause — the exercise catalog was copied across ~7 repos with no sync; the production fork was −10, missing the entire `rehab_mobility` category; (3) why it's a safety bug — governance can only act on a shared vocabulary; an exercise the layer doesn't know, it can't strip or reason about; (4) the fix — one canonical catalog (152 names) as the single source of truth, vendored + deterministic codegen + CI drift-checks, with a regression test (the 10 names are now known) and an end-to-end test (a plan with a rehab exercise compiles), shipped to production; (5) honest coda — drift is a safety risk; this class is closed and the drift-checks are what stop the next one; no clinician validation claimed.
- [ ] **Step 2: Fact-check.** `grep -niE "clinician.validated|0 violations|safe now|guarantee.*safe" src/app/blog/posts/wpl-production-safety-blind-spot.mdx` → returns nothing (no overclaim). Confirm the rehab names + "152" + "single source of truth" framing match spec §2.
- [ ] **Step 3: Build.** `npm run build` → succeeds.
- [ ] **Step 4: Commit.** `git add src/app/blog/posts/wpl-production-safety-blind-spot.mdx && git commit -m "blog: add WPL v0.7.1 production-safety-gap post"`

### Task A3 — Refresh `two-lane` (fix retracted 0/60)

**Files:** Modify `src/app/blog/posts/two-lane-llm-safety-benchmark.mdx` (the multi-turn paragraph, ~line 75: "Lane A: 25 out of 60 … Lane B: 0 out of 60").

- [ ] **Step 1: Fix the stale numbers.** Replace the "25 out of 60 (42%) … 0 out of 60" sentence with the corrected, consistent figures from `multi-turn-llm-drift.mdx` / spec §2: raw drift 42% (44/105 conversations), WPL 6%, Anthropic 0/45. Add a short parenthetical that the clean Lane-B zero was a measurement-bug artifact, corrected — mirroring the honesty footnotes already in the sibling posts. Do NOT alter the 3–5× / ~40%→~10% framing elsewhere (still valid).
- [ ] **Step 2: Verify no retracted zero remains.** `grep -niE "0 out of 60|0/60|25 out of 60" src/app/blog/posts/two-lane-llm-safety-benchmark.mdx` → returns nothing.
- [ ] **Step 3: Build + commit.** `npm run build` then `git add -p`/`git commit -m "blog: correct stale Lane-B drift figure in two-lane post"`

### Task A4 — Forward-notes + series footers across the 6

**Files:** Modify all 6: `llm-fitness-plans-dangerous.mdx`, `two-lane-llm-safety-benchmark.mdx`, `multi-turn-llm-drift.mdx`, `compile-time-safety-contract-llm.mdx`, `bigger-llms-arent-safer.mdx`, `llm-indentation-end-markers.mdx`.

- [ ] **Step 1: Forward-note on the 3 effectiveness posts.** In `llm-fitness-plans-dangerous`, `two-lane`, `multi-turn-llm-drift`, add 1–2 sentences (near the existing honesty footnote, or end) noting that v0.7 found the Lane B "rules a trainer would configure" were partly circular (derived from the grading blacklist), so the Lane B figures are expected to come down on a pending de-circularized re-run — with a link to Blog A (`/blog/wpl-auditing-your-own-safety-evals`). Frame as honest continuation, not retraction of the 3–5× direction.
- [ ] **Step 2: Series footer on all 6.** Add a consistent short footer linking the two new posts: Blog A (`/blog/wpl-auditing-your-own-safety-evals`) and Blog B (`/blog/wpl-production-safety-blind-spot`). Match the existing "this is a series" phrasing style used in `llm-fitness-plans-dangerous` line ~104.
- [ ] **Step 3: Verify links + build.** `grep -RnoE "/blog/wpl-(auditing-your-own-safety-evals|production-safety-blind-spot)" src/app/blog/posts/ | wc -l` ≥ 9 (3 forward-notes + footers across 6 ≈ at least 9 references). `npm run build` succeeds.
- [ ] **Step 4: Commit.** `git commit -am "blog: add v0.7 forward-notes and series footers to WPL posts"`

---

## Task Group B — wpl-eval docs

> Branch `wpl-v07-content` (already created; spec committed). Repo: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval`.
> Gate: markdown only — verify with the fact-check greps below; no build needed.

### Task B1 — README v0.7/v0.7.1 status

**Files:** Modify `README.md`. (Read it first; it currently leads with v0.6 corrected headlines + a correction notice.)

- [ ] **Step 1: Update.** Keep the v0.6 corrected numbers as the cited corpus. Add a short "Since v0.6" subsection (or update the headline framing) covering: v0.7 shipped — enforce() now in the published `@gymbile/wpl-validator`; honesty fixes (de-circularized rules, independent extractor, fail-closed, CIs, matcher plural fix); v0.7.1 shipped — canonical exercise catalog SSOT; packages published. Update the npm pin line (`npm install` comment) to `@gymbile/wpl-ai ^2.1.0`, `@gymbile/wpl-validator ^1.9.0`. Add one sentence that a de-circularized full re-run is the next budgeted step (no new % yet). Link `docs/V0_7_RESULTS.md`.
- [ ] **Step 2: Fact-check.** `grep -niE "0 of 269|1.8.0|2.0.0" README.md` — ensure version pins now say 1.9.0/2.1.0 (no stale 1.8.0/2.0.0 install pins); `grep -niE "new.*safety.*(rate|percent)|re-?ran the corpus" README.md` → nothing implying a fresh re-run happened.
- [ ] **Step 3: Commit.** `git add README.md && git commit -m "docs: README — v0.7/v0.7.1 status + updated package pins"`

### Task B2 — `docs/V0_7_RESULTS.md` (new)

**Files:** Create `docs/V0_7_RESULTS.md`. (Skim `docs/V0_6_RESULTS.md` first to match structure/tone.)

- [ ] **Step 1: Write.** Sections: (a) What changed v0.6→v0.7 (the honesty fixes + enforcement-in-library, fail-closed, repairs ledger — spec §2); (b) What's superseded (the retracted zeros; Lane B partial-circularity → numbers expected lower); (c) What's pending (full de-circularized re-run — no new headline %; $0 rescore showed 0/269 frozen trials fail-closed, numbers stable); (d) v0.7.1 — canonical catalog SSOT, the production rehab gap and its closure, packages published (versions); (e) honest non-claims (no clinician validation; alias/contraindication SSOT are future).
- [ ] **Step 2: Fact-check.** `grep -niE "0 violations|clinician.validated|re-?ran" docs/V0_7_RESULTS.md` → only in explicitly-superseded/"not done" framing. Confirm versions 1.9.0/2.1.0 and `wpl v1.8.0` tag.
- [ ] **Step 3: Commit.** `git add docs/V0_7_RESULTS.md && git commit -m "docs: add V0_7_RESULTS — v0.6→v0.7→v0.7.1 changes"`

---

## Task Group C — gymbile_backend drafts, LinkedIn, press

> Branch `wpl-v07-content` off `master` in `/Users/alex/Projects/my/gymbile.com/gymbile_backend`. Markdown only; verify with greps.

### Task C1 — Update v0.7 draft + finalize LinkedIn #1; tidy collection

**Files:** Modify `wpl_v0.7_post.md`; move superseded `wpl_linkedin_post.md`, `wpl_linkedin_post_v2.md`, `wpl_linkedin_post_v3.md` → `archive/`.

- [ ] **Step 1: Branch.** `git -C /Users/alex/Projects/my/gymbile.com/gymbile_backend checkout -b wpl-v07-content master`
- [ ] **Step 2: Update `wpl_v0.7_post.md`.** Flip the stale guardrails: v0.7 is shipped (npm `@gymbile/wpl-validator@1.9.0` + `@gymbile/wpl-ai@2.1.0`; Hex live). Change "rolling out"/"pending" → shipped. Keep "no new safety %"/"re-run pending" (still true). Ensure the LinkedIn-version section is the finalized **LI #1** (target post date Mon 2026-06-23): "we made our numbers worse on purpose", links the Blog A URL `https://alexfilatov.com/blog/wpl-auditing-your-own-safety-evals`, ≤ ~1,300 chars, `→` bullets, 3–4 hashtags.
- [ ] **Step 3: Tidy.** `mkdir -p archive && git mv wpl_linkedin_post.md wpl_linkedin_post_v2.md wpl_linkedin_post_v3.md archive/` (these predate v0.7; superseded by the post files' LinkedIn sections). Leave `wpl_press_kit.md`/`wpl_press_outreach.md` in place (refreshed in C3).
- [ ] **Step 4: Fact-check.** `grep -niE "rolling out|pending publish|0 violations" wpl_v0.7_post.md` → nothing.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "docs(wpl): update v0.7 post to shipped status; finalize LinkedIn #1; archive superseded drafts"`

### Task C2 — v0.7.1 long-form + LinkedIn #2

**Files:** Create `wpl_v0.7.1_post.md` (mirrors the structure of `wpl_v0.7_post.md`: long-form section + LinkedIn section).

- [ ] **Step 1: Write.** Long-form section = the source/back-reference for Blog B (production-gap → SSOT → shipped; spec §3.2). LinkedIn section = **LI #2** (target post date Wed 2026-06-25): hook on the blind spot ("our safety layer didn't know post-injury rehab exercises existed — in production"), the SSOT fix, shipped; link Blog B `https://alexfilatov.com/blog/wpl-production-safety-blind-spot`; ≤ ~1,300 chars, `→` bullets, 3–4 hashtags. Add the same honesty-guardrails header block the v0.7 draft uses (no overclaim, no clinician validation).
- [ ] **Step 2: Fact-check.** `grep -niE "clinician.validated|safe now|0 violations" wpl_v0.7.1_post.md` → nothing. Confirm rehab names + "152" + versions.
- [ ] **Step 3: Commit.** `git add wpl_v0.7.1_post.md && git commit -m "docs(wpl): add v0.7.1 long-form + LinkedIn #2 drafts"`

### Task C3 — Press kit / outreach refresh

**Files:** Modify `wpl_press_kit.md`, `wpl_press_outreach.md`.

- [ ] **Step 1: Refresh.** Update status lines to v0.7.1: shipped, packages live (1.9.0/2.1.0), production rehab gap closed, enforce in the library. Keep all claims inside spec §2 (no new %, no clinician validation). Update any stale version/URL references.
- [ ] **Step 2: Fact-check.** `grep -niE "0 violations|1.8.0|2.0.0|rolling out" wpl_press_kit.md wpl_press_outreach.md` → nothing stale.
- [ ] **Step 3: Commit.** `git add wpl_press_kit.md wpl_press_outreach.md && git commit -m "docs(wpl): refresh press kit + outreach to v0.7.1"`

---

## Task Group E — "Why WPL" intro paragraph in both READMEs (VERIFIED numbers)

> A simple, plain-language paragraph at the top of the `wpl` and `wpl-eval` READMEs: what WPL is, why it's better, with proof numbers from the latest evals. **All numbers below were verified on 2026-06-19** by regenerating `headline-all.mjs` from the committed `results/` AND cross-checking the blacklist-only table in `docs/V0_6_RESULTS.md`. DO NOT alter these numbers; DO NOT add any number not in this list.
>
> **Verified fact base (blacklist = contraindicated-exercise measure):**
> - Raw LLM unsafe-plan rate **32–51%** (32% OpenAI-long single … 51% short-plan multi); WPL **8–17%**; reduction **3–5×** (computed 3.0–4.0× per corpus) on every corpus, both single- and multi-turn.
> - Multi-turn contraindication drift: raw **42% (44/105)** → WPL **6%**; **0% (0/45) on the Anthropic corpus**.
> - **560 trials, 7 models (OpenAI + Anthropic), ~$170, 0 errors**; every number reproduces from committed model outputs.
> - Do NOT cite the structural-inclusive short-plan "77%" (different measure) and never the retracted "0 violations"/"0/60".

### Task E1 — `wpl` spec repo README intro

**Files:** Modify `/Users/alex/Projects/my/gymbile.com/wpl/README.md` (insert after the existing opening lines, before "This repository is the **source of truth**…").

- [ ] **Step 1: Branch.** `git -C /Users/alex/Projects/my/gymbile.com/wpl checkout -b wpl-v07-content main`
- [ ] **Step 2: Insert the paragraph** (verbatim numbers; light prose edits allowed, numbers fixed):

  ```markdown
  ## Why it matters

  A wellness plan isn't a chat reply — if it's wrong, a client gets hurt. WPL lets an AI author plans through a validated grammar with a rule engine that removes exercises contraindicated for the individual client *before* a human ever sees them. The effect is measured, not asserted: in a public 560-trial benchmark across 7 OpenAI and Anthropic models, raw LLMs put a contraindicated exercise into **32–51%** of plans; the same models speaking through WPL drop to **8–17%** — a **3–5× reduction**, on every corpus and in both single-turn and multi-turn conversations. In multi-turn chats, raw models drift off a contraindication the user already stated **42%** of the time; through WPL, **6%** (and **0%** on the Anthropic set). Full data + methodology: [wpl-eval](https://github.com/gymbile/wpl-eval).
  ```
- [ ] **Step 3: Fact-check.** `grep -nE "32–51%|8–17%|3–5×|42%|6%|0%|560-trial" README.md` shows the inserted numbers; `grep -niE "0 violations|0/60|77%" README.md` → nothing.
- [ ] **Step 4: Commit.** `git add README.md && git commit -m "docs: add 'why WPL' intro with verified eval numbers"`

### Task E2 — `wpl-eval` README intro

**Files:** Modify `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/README.md` (insert a short "Why this exists" paragraph right after the opening two-line description, before "**Current corpus: v0.6**"). On the `wpl-v07-content` branch (coordinate with Task B1, which edits the corpus/status framing lower in the file — no overlap).

- [ ] **Step 1: Insert the paragraph** (verbatim numbers):

  ```markdown
  **Why this exists, in one paragraph.** An LLM will happily prescribe an exercise that's dangerous for a client's injury. WPL is a safety layer that makes the model write its plan through a structured grammar, then strips contraindicated exercises against that client's constraints before the plan is served — and this repo measures the difference. Across **560 trials** and **7 models** (OpenAI + Anthropic), raw LLMs produced a plan with a contraindicated exercise **32–51%** of the time; the *same* models routed through WPL: **8–17%** — a **3–5× reduction**, on every corpus and in both single- and multi-turn conversations. In multi-turn coaching chats, raw models forget a contraindication the user already stated **42%** of the time; through WPL, **6%** (and **0%** on the Anthropic set). Every number reproduces from the committed model outputs in `results/`.
  ```
- [ ] **Step 2: Fact-check.** `grep -nE "32–51%|8–17%|3–5×|42%|6%|0%" README.md` shows the inserted numbers and they MATCH Task E1 / `docs/V0_6_RESULTS.md` blacklist table; `grep -niE "0 violations|0/60" README.md` → nothing new.
- [ ] **Step 3: Commit.** `git add README.md && git commit -m "docs: add 'why WPL' intro with verified eval numbers"`

---

## Task Group D — Final consistency pass

### Task D1 — Cross-artifact consistency + no-superseded-number sweep

**Files:** read-only across all three repos.

- [ ] **Step 1: Superseded-number sweep.** In each repo's changed files, grep for forbidden live stats: `grep -RniE "0 violations|0 of 60|0/60" <changed files>` → nothing except inside explicit "this was a bug, corrected" framing. Grep for invented percentages not in spec §2.
- [ ] **Step 2: Version consistency.** Every package reference says `@gymbile/wpl-validator@1.9.0` / `@gymbile/wpl-ai@2.1.0` / Hex `1.9.0`/`2.1.0` / spec tag `v1.8.0`. No stray `1.8.0`/`2.0.0` install pins.
- [ ] **Step 2b: README intro numbers match (E1/E2).** The "why WPL" paragraph in `wpl/README.md` and `wpl-eval/README.md` cite IDENTICAL verified figures (32–51% → 8–17%, 3–5×, 42%→6%, 0% Anthropic, 560 trials/7 models) and these match `wpl-eval/docs/V0_6_RESULTS.md` blacklist table. No structural-inclusive "77%" anywhere; no retracted zeros.
- [ ] **Step 3: Cross-links resolve.** Blog A ↔ Blog B link each other; all 6 old posts footer-link both; LinkedIn #1→Blog A, #2→Blog B URLs correct (`alexfilatov.com/blog/<slug>`); README links `docs/V0_7_RESULTS.md`.
- [ ] **Step 4: Build gate.** `npm run build` in alexfilatov.com passes with all changes.
- [ ] **Step 5: Report.** Summarize per-repo commits; list anything left for Alex (cover images for the 2 posts; the actual LinkedIn posting; push/deploy approval).

---

## Self-review notes

- **Spec coverage:** Blog A→A1; Blog B→A2; two-lane fix→A3; forward-notes+footers→A4; README status→B1; V0_7_RESULTS→B2; v0.7 draft update + LI#1 + tidy→C1; v0.7.1 draft + LI#2→C2; press refresh→C3; "why WPL" README intros (§3.6)→E1/E2; consistency→D1. All spec §3 items covered.
- **Honesty floor:** every content task has a fact-check grep step tied to spec §2; D1 is a final backstop. No task introduces a new safety %.
- **No placeholders:** outlines + frontmatter are concrete; prose is authored at execution from the spec fact base (content can't be pre-written without being the deliverable). Cover images intentionally deferred to Alex (stated).
- **Consistency:** slugs fixed (`wpl-auditing-your-own-safety-evals`, `wpl-production-safety-blind-spot`) and reused identically in A1/A2/A4/C1/C2/D1; versions fixed (1.9.0/2.1.0) everywhere.
