# WPL v0.7 / v0.7.1 Content Update — Design Spec

**Status:** Approved (design). Date: 2026-06-19. Author: gymbile-eng.
**Goal:** Extend the public "WPL Safety Evals" content (blog series on alexfilatov.com, a LinkedIn series, and supporting docs) to cover v0.7 (honest-methodology + enforcement work, now shipped) and v0.7.1 (canonical exercise catalog that closed a real production safety gap, now deployed) — without breaking the series' honesty standard.

---

## 1. Voice & style (match the existing series)

- First person ("I"), direct, technical-but-accessible. The narrator is the builder, not a marketer.
- Data-forward: specific numbers, always traceable to `results/*.json` or a named source. No vague superlatives.
- Honest by default: when a number was wrong, say so and show the corrected one. The series' credibility IS the product.
- No hype words ("revolutionary", "game-changing"). No emoji in blog bodies. LinkedIn may use sparing `→` bullets and 3–4 hashtags (matching the existing LinkedIn draft).
- Each blog post is one idea, told as a story with a concrete finding.
- MDX frontmatter required: `title`, `publishedAt` (YYYY-MM-DD), `summary`, `tag: "WPL Safety Evals"`, `image: "/images/blog/wpl-evals/<slug>/cover.jpg"`.

## 2. Fact base (the honesty floor — every artifact must stay inside this)

**v0.6, corrected (already published, do not contradict):**
- Lane A unsafe-plan rate 32–51%; Lane B 8–17%; 3–5× reduction across corpora/phases.
- Multi-turn blacklist drift: raw 42% (44/105 conversations); WPL 6%; Anthropic corpus 0/45.
- 560 trials, ~$170 to reproduce; raw-JSON probe 0/5 plans passed validation; Haiku END-markers 7/15→14/15.
- The retracted **"0 violations" / "0 of 60" Lane B** numbers were a plan-walker measurement bug. NEVER reuse them as live stats.

**v0.7 (SHIPPED 2026-06-16..18 — packages live):**
- Enforcement (`enforce()` — the part that strips a contraindicated exercise) moved from the eval harness INTO the published validator.
- Compiler **fails closed** on safety paths (a typo'd safety section is now a hard error, not a silent delete).
- **Repairs ledger**: every silent normalization the model made is recorded for a human reviewer.
- **De-circularization**: Lane B "rules a trainer would configure" had been derived from the same blacklist used for grading — the filter had the answer key. Rules are now authored from the client's clinical picture, independent of the grading key. In one scenario this flipped a near-zero violation count to **7** (the 7 is the honest number).
- **Independent extractor**: one fixed extractor model for every trial (previously each model extracted its own output → more capable models looked *less* safe).
- **Honest disclosure**: only 3 of 7 models accept a temperature setting; confidence intervals added; docs rewritten to match the code.
- **Matcher plural fix**: `push_ups` no longer slips past a `push_up` rule (the old matcher undercounted violations).
- Published: npm `@gymbile/wpl-validator@1.9.0`, `@gymbile/wpl-ai@2.1.0`; Hex `wpl_validator 1.9.0`, `wpl_ai 2.1.0`; spec tag `wpl v1.8.0`.
- **$0 rescore census**: 0 of 269 frozen Lane B trials fail-closed under the 2.x library (frozen numbers stable).
- **NOT done:** a full paid re-run of the corpus under the de-circularized methodology. So there are **NO new headline safety percentages**. When that re-run happens, the Lane B numbers are expected to be *smaller* than the v0.6-corrected ones (because the old rules were partly circular and the old matcher failed open).

**v0.7.1 (SHIPPED to production 2026-06-18):**
- The exercise catalog (the vocabulary of known exercises) was duplicated across ~7 repos with no sync, and had drifted. Gymbile's in-house production fork was missing the **entire `rehab_mobility` category** (plus `inverted_row`, `hangboard`) — 10 names.
- **Live impact:** post-injury clients' rehab exercises (`scapular_retraction`, `external_rotation`, `pelvic_tilt`, `diaphragmatic_breathing`, …) resolved as "unknown" to the production compiler/safety layer. A safety layer that doesn't know an exercise exists can't govern it.
- **Fix:** one canonical catalog (152 names) in the `wpl` spec repo as the single source of truth; every consumer vendors a copy + generates its native module via deterministic codegen, guarded by CI drift-checks (vendored-JSON-matches-the-pinned-release + re-run-codegen-produces-no-diff). Backend regained the 10 names with a regression test asserting they're now known, plus an end-to-end test that a plan containing a rehab exercise compiles.
- Deployed to production.
- (Out of scope / honest non-claims: no clinician validation of the catalog; alias table + contraindication-data SSOT are future phases.)

## 3. Deliverables

### 3.1 Blog A — v0.7 (adapt existing draft)
- **Source:** `gymbile_backend/wpl_v0.7_post.md` (long-form section). Slug suggestion: `wpl-auditing-your-own-safety-evals`.
- **Angle:** integrity/credibility — "we made our own numbers look worse, on purpose." NOT "the numbers got better."
- **Required updates to the draft (its guardrails are now stale):**
  - v0.7 is shipped: change "rolling out"/"still pending" → enforcement now lives in the **published** library (`@gymbile/wpl-validator@1.9.0` / Hex `wpl_validator 1.9.0`).
  - Keep "no new safety percentages; full re-run pending" — still true.
  - Add a one-line forward pointer to the v0.7.1 post (the production-gap story) at the end.
- **Frontmatter:** `publishedAt: "2026-06-23"`, `tag: "WPL Safety Evals"`, cover placeholder path.

### 3.2 Blog B — v0.7.1 (new)
- **Slug suggestion:** `wpl-production-safety-blind-spot`.
- **Title direction:** "Our Safety Layer Had a Blind Spot in Production" (or similar; one honest, concrete claim).
- **Structure:** (1) the symptom — a class of clients (post-injury rehab) whose exercises the live safety layer treated as unknown; (2) the root cause — the exercise catalog was copied into ~7 repos and drifted, production was −10 including the whole rehab category; (3) why this is a *safety* bug, not a code-smell — governance can only act on a vocabulary it shares; (4) the fix — single source of truth (canonical JSON + vendor + codegen + drift-checks), regression + e2e tests, shipped to prod; (5) the honest coda — drift is a safety risk; this class is closed, the general discipline (drift-checks) is what prevents the next one.
- **Frontmatter:** `publishedAt: "2026-06-25"`, `tag: "WPL Safety Evals"`, cover placeholder path.

### 3.3 Refresh the existing 6 posts
- **`two-lane-llm-safety-benchmark.mdx` line ~75:** replace the stale "Lane A: 25 out of 60 … Lane B: 0 out of 60" with the corrected figures (42% raw / 6% WPL over 105 conversations, Anthropic 0/45), consistent with `multi-turn-llm-drift.mdx`. Add a brief parenthetical that the clean-zero was a measurement bug (mirroring the other posts' honesty footnotes).
- **Forward-note on the 3 effectiveness posts** (`llm-fitness-plans-dangerous`, `two-lane`, `multi-turn-llm-drift`): one or two sentences (+ link to Blog A) noting v0.7 found the Lane B rules were partly circular (built from the grading key), so the Lane B figures are expected to shrink on a pending re-run. Phrase as honest continuation, not retraction of the 3–5× direction.
- **"Series continues" footer on all 6:** short links to Blog A (v0.7) and Blog B (v0.7.1).
- The 3 non-effectiveness posts (`compile-time-safety-contract-llm`, `bigger-llms-arent-safer`, `llm-indentation-end-markers`) get only the footer link — their findings (JSON-schema ceiling, cross-vendor capability/safety, END-markers) are unaffected by de-circularization.

### 3.4 LinkedIn (2 posts; Alex posts manually, starting Monday)
- **LI #1 — Mon 2026-06-23 (v0.7 credibility):** adapt the LinkedIn section of `wpl_v0.7_post.md`; update to "shipped" (packages live); link Blog A. Keep the "we made our numbers worse on purpose" hook.
- **LI #2 — Wed 2026-06-25 (v0.7.1 production gap):** new; hook on the blind spot ("our safety layer didn't know post-injury rehab exercises existed — in production"); link Blog B. ≤ ~1,300 chars, `→` bullets, 3–4 hashtags (`#AISafety #HealthTech #ResponsibleAI`).
- Saved as clean markdown in the consolidated draft set (§3.5), each clearly labeled with its target post date.

### 3.5 Other documents
- **`wpl-eval/README.md`:** update the "Current corpus" / headline framing to note v0.7 (enforce shipped in the library; honesty fixes) and v0.7.1 (catalog SSOT; packages published at the new versions). Keep the v0.6 corrected numbers as the cited corpus; add that a de-circularized re-run is the next budgeted step. Update the npm/Hex version pins referenced.
- **`wpl-eval/docs/V0_7_RESULTS.md` (new):** a changelog/results companion — what changed v0.6→v0.7→v0.7.1, the honesty fixes, what's superseded (the retracted zeros; Lane B partial-circularity), what's pending (full re-run), and the v0.7.1 catalog/gap summary. Mirrors the style of `docs/V0_6_RESULTS.md`.
- **`gymbile_backend/wpl_press_kit.md` + `wpl_press_outreach.md`:** refresh status lines to v0.7.1 (shipped, packages live, production gap closed); keep claims inside the fact base.
- **Tidy the draft collection (`gymbile_backend/wpl_*.md`):** consolidate into a clean current set. Keep the current long-form v0.7 + new v0.7.1 + the 2 final LinkedIn posts + press kit/outreach; move superseded `wpl_linkedin_post.md` / `_v2` / `_v3` into an `archive/` (or clearly mark them superseded). Do not delete history; just make "what's current" obvious.

## 4. Constraints / non-goals
- Do not run the paid corpus re-run; do not invent any new safety percentage.
- Do not mutate `wpl-eval/results/` or any frozen corpus data.
- Do not publish to LinkedIn (Alex posts manually). Do not deploy alexfilatov.com (Alex controls publish); local commits only unless asked.
- Cover images for the 2 new posts are placeholders — Alex supplies the final art.
- No Claude/AI attribution in any commit.

## 5. Execution
After this spec is approved and reviewed, proceed via writing-plans → subagent-driven execution. A single shared brief (this spec's §1–§2) anchors voice + fact accuracy across every artifact; a final consistency pass checks all cross-links resolve and no superseded number reappears.
