# wpl.dev/eval — Interactive Page Spec

Static, data-driven, single-page application. All data is read at build time from the committed JSON in `wpl-eval/results/` and `wpl-eval/scenarios/scenarios.yaml`. No backend, no API, no database. Deployable to Vercel / Cloudflare Pages / GitHub Pages.

---

## 1. Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **Astro 4** with React islands | Ships near-zero JS for static parts; interactive panels hydrate independently. The page is mostly static text with a few stateful widgets — Astro's island model is the right tool. |
| Styling | Tailwind | Already in gymbile.com toolchain. |
| Data ingestion | Build-time script (`scripts/build-data.ts`) | Reads `results/*.json` + `scenarios/scenarios.yaml`, emits one normalised `eval-data.json` consumed by the page. Re-run when results change. |
| Annotations | Hand-authored `annotations.yaml` | One block per scenario × violation pattern, mapping exercise → citation. Surfaced as tooltips on Lane A `⚠` markers. |
| Deploy | Static export, CDN-hosted under `wpl.dev/eval` | Page is fully prerendered; interactivity is client-side over JSON. |

---

## 2. URL structure

| Route | Purpose |
|---|---|
| `/eval` | Landing — overview, headline numbers, "pick a scenario" entry point. |
| `/eval/s/:scenarioId` | Scenario view (the main interactive page). Default model=`gpt-5`, mode=`multi`, effort=`minimal`. |
| `/eval/s/:scenarioId?model=...&mode=...&effort=...` | Stateful view; switches update the URL so links are shareable. |
| `/eval/methodology` | Links to the public `METHODOLOGY.md` + `INDUSTRY_REPORT.md` in the eval repo. |

URL state is the source of truth — switches read/write `URLSearchParams`. No client-side router needed beyond this.

---

## 3. Data contract

Build-time script produces a single file `eval-data.json`:

```ts
type EvalData = {
  meta: {
    version: string;                    // "v0.1.0"
    generatedAt: string;                // ISO timestamp
    models: ModelId[];                  // ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4o-mini"]
    aggregate: {
      laneAUnsafe: number;              // 14
      laneATrials: number;              // 40
      laneBUnsafe: number;              // 0
      laneBTrials: number;              // 80
      laneBServed: number;              // 29
      laneBCompileFailed: number;       // 51
      laneBStripped: number;            // 0
    };
  };
  scenarios: Scenario[];
};

type Scenario = {
  id: string;                           // "torn_meniscus"
  title: string;                        // "Torn meniscus · 6mo post-op"
  category: "medical" | "adherence";
  constraintSummary: string;            // one-line plain-English
  safetyRationale: string;              // multi-line, cites guidelines
  blacklist: BlacklistEntry[];
  perModel: {
    [modelId: string]: {
      single: TrialPair;                // { laneA: Trial, laneB: Trial }
      multi:  TrialPair;
    };
  };
  // sparkline: number of models with ≥1 Lane A unsafe in this scenario
  unsafeModelCount: number;             // 0–4 → maps to ●●●● rendering
};

type TrialPair = {
  laneA: TrialA;
  laneB: TrialB;
};

type TrialA = {
  resultFile: string;                   // "gpt-5__torn_meniscus__A__multi.json"
  turns: TurnMessage[];                 // length 1 for single-turn, 7 for multi
  extractedPlansPerTurn: ExtractedPlan[]; // parallel array, may have null entries
  safetyViolationsPerTurn: Violation[][];
  driftTurn: number | null;             // first turn with a fresh violation; null = no drift
  totalUnsafeCount: number;
};

type TrialB = {
  resultFile: string;
  outcome: "served" | "compile_failed" | "stripped_clean" | "stripped_with_residual";
  turns: TurnMessage[];
  served?: {
    wplDocument: object;                // parsed WPL JSON
    summary: { phases: PhaseSummary[] };
  };
  compileError?: {
    errorCode: string;                  // "WEEK_HAS_NO_VALID_DAYS"
    repairHint: RepairHintPayload;
    rawValidatorOutput: object;
  };
  stripCounts: { rule: string; count: number }[];
};

type Violation = {
  turn: number;
  exercise: string;                     // canonical name as matched
  rawPhrase: string;                    // exact substring from model output
  category: "exercise" | "intensity";
  citationKey?: string;                 // → annotations.yaml lookup
};

type AnnotationEntry = {
  scenarioId: string;
  exercise: string;
  shortReason: string;                  // tooltip text: "deep knee flexion under load"
  citation: string;                     // "Cavanaugh & Powers 2017"
  citationUrl?: string;
};
```

`annotations.yaml` is human-authored (not generated) — one entry per `(scenarioId, exercise)` pair. Build script joins violations to annotations and fails loudly on unmatched pairs to keep coverage honest.

---

## 4. Component tree

```
EvalPage (Astro page, prerendered per scenarioId)
├── PageHeader              [static]
│   ├── version pill
│   └── nav (methodology · repo · paper)
│
├── ScenarioPicker          [React island, client:idle]
│   ├── ScenarioListItem × 10
│   │   ├── title
│   │   ├── sparkline (●●●●)
│   │   └── selected state from URL
│   └── AggregateFootnote (Lane A 14/40 · Lane B 0/80 · served 29/80)
│
├── ScenarioPane            [React island, client:load]
│   ├── ScenarioHeader
│   │   ├── title + constraint summary
│   │   ├── ModelSelect  (4 buttons)
│   │   ├── TurnModeToggle (single | multi)
│   │   └── EffortToggle  (minimal | medium)
│   │
│   ├── LaneSplitView                  ◀── the money shot
│   │   ├── LaneAPanel
│   │   │   ├── PlanRender             ◀── markdown + ⚠ annotation injection
│   │   │   ├── ViolationCallouts      ◀── inline tooltips
│   │   │   └── ExpandFullPlanToggle
│   │   └── LaneBPanel
│   │       ├── (if served)    ServedPlanRender + stripCounts + refused=0
│   │       ├── (if compile_failed) RepairHintCard with structured error JSON
│   │       └── (if stripped)  StripResultCard
│   │
│   ├── DriftTimeline                  [only when mode=multi]
│   │   ├── TurnDot × 7  (●/◐/✕ per turn)
│   │   ├── DriftPhraseCallout         ◀── "we'll cycle in some plyometrics"
│   │   └── TurnDrawer                 ◀── opens to show the full assistant message
│   │
│   ├── PerModelStrip
│   │   └── ModelCell × 4  (count + bar)
│   │
│   └── RawJsonFooter (deep link to results/*.json on GitHub)
│
└── PageFooter
    ├── reproduce-it CTA  ("git clone … && pnpm sweep")
    └── licence + cite-this block
```

State scope: the only client-side state is `{ scenarioId, model, mode, effort, openTurn }`, all driven by URL params. No global store needed — pass as props from `ScenarioPane`.

---

## 5. Key interactions

**Scenario switch.** Click in left rail → URL updates → `ScenarioPane` re-reads the corresponding `Scenario` from `eval-data.json`. Server-rendered version (initial paint) uses the URL param at build time so there's no flash.

**Model / mode / effort switch.** Same pattern — URL params drive which `TrialPair` is rendered. All four model variants are already in `eval-data.json`; no fetch.

**Violation tooltip.** Hover/tap a `⚠` marker → tooltip shows `annotations[scenarioId][exercise].shortReason` + citation chip. Citation chip is a link if `citationUrl` is set.

**Lane B "refused" → "served" reveal.** When the chosen `(model, mode, effort)` triple lands on `compile_failed`, the Lane B panel renders the `RepairHintCard` instead of a plan. The card has a toggle "show raw validator output" that expands the full JSON. This is the single most important UI element for the safety-vs-delivery narrative — it makes the orchestrator handoff tangible.

**Drift timeline turn-click.** Clicking a turn dot expands a drawer below the timeline with the assistant message verbatim. The phrase that introduced the violation is highlighted. URL gains `?turn=5` for shareability.

**Deep-link to raw JSON.** Footer link points at the file on GitHub at the tagged release commit — readers can verify any displayed number against source.

---

## 6. Visual / rendering rules

- **Plan rendering.** Both lanes use the same plan-renderer component. Input is either (a) the raw assistant markdown (Lane A) or (b) a synthesised markdown view of the WPL JSON document (Lane B). Same component → visually comparable side-by-side.
- **Inline ⚠ annotation.** Done at build time. The build script runs each Lane A turn through the same scoring matcher used by the eval, records `(startIndex, endIndex, exercise)` spans, and emits a `spans` array alongside the turn text. Renderer wraps spans in `<mark data-exercise="…">`.
- **Sparkline dots.** Pure CSS — four `<span>`s with `data-state` attribute.
- **Drift dot states.**
  - `●` green: safe turn
  - `◐` amber: softening language without a blacklist hit ("let's add some power work")
  - `✕` red: fresh violation introduced this turn
- **Lane B outcome styling.**
  - `served` → green check, plan shown
  - `compile_failed` → amber, RepairHintCard shown
  - `stripped_clean` → blue, "plan delivered after rule evaluator removed N exercises"
- **No animations** other than the turn drawer expand. The page is a receipt, not a marketing site.

---

## 7. Accessibility

- All toggles are real `<button>` / `<input type=radio>` — keyboardable, screen-reader labelled.
- `⚠` markers are real `<button>` elements (not pure decoration) so the tooltip is reachable.
- Side-by-side lanes collapse to stacked on `< 900px` viewport, Lane A first.
- All colour signal is paired with an icon or text (`✓ Served`, `✗ Compile failed`).

---

## 8. Build pipeline

```
1. scripts/build-data.ts
   ├── read scenarios/scenarios.yaml
   ├── glob results/*.json
   ├── for each result: parse, attach extracted plans, attach per-turn violations,
   │   compute span offsets, look up annotations
   ├── assert: every violation has a matching annotation entry (fail build if not)
   └── write src/data/eval-data.json

2. astro build
   ├── prerender /eval/s/:scenarioId for each of 10 scenarios
   └── output dist/
```

A failed annotation lookup blocks the build — this is deliberate. It forces the annotation file to stay in sync with the data and prevents "missing tooltip" regressions.

---

## 9. What's NOT in scope for v1

- User-submitted prompts (this is a results viewer, not a live demo).
- Multi-version comparison (only `v0.1.0` shown; later releases get their own URL prefix `/eval/v0.2/...`).
- Search / filter beyond the 10-scenario rail.
- Analytics beyond standard page-view (no engagement tracking — page is documentary).

---

## 10. Effort estimate

| Phase | Days |
|---|---|
| `build-data.ts` + `annotations.yaml` authoring | 1.0 |
| Component implementation (ScenarioPicker, ScenarioPane, LaneSplitView) | 1.5 |
| DriftTimeline + TurnDrawer + RepairHintCard | 1.0 |
| Polish, a11y, mobile, copy review | 0.5 |
| **Total** | **~4 days** for one frontend dev |

The annotation authoring is the hidden cost — it's roughly 60–80 `(scenario, exercise) → citation` mappings to write by hand, mostly already drafted in `scenarios.yaml` `safety_rationale` fields and `INDUSTRY_REPORT.md` violation tables. Plan for half a day of careful transcription.

---

## 11. Site ↔ eval-repo coupling

The site is a *consumer* of the eval repo. Getting this boundary right matters because the eval is published, versioned, and tagged, and the site must show numbers that match the tag — not whatever happens to be on disk.

### 11.1 How the site pulls eval data

Three plausible options, ranked:

| Option | How it works | Verdict |
|---|---|---|
| **A. Pin a release tarball** *(recommended)* | Site build downloads `https://github.com/gymbile/wpl-eval/archive/refs/tags/v0.1.0.tar.gz`, extracts `results/` and `scenarios/`, runs `build-data.ts` against it. The tag is configured in `site/eval.config.ts`. | Loose coupling, deterministic, the tag is the contract. Bumping eval versions = one line change in the site repo. |
| B. Git submodule | `site/vendor/wpl-eval` is a submodule pinned at the release commit. | Works but submodules are operationally annoying for non-Git-savvy contributors and don't add value over (A). |
| C. Live fetch from GitHub raw URLs at site runtime | Page loads `results/*.json` over the network. | Rejected. Adds runtime dependency on GitHub, breaks offline review, and makes "the number on screen" non-deterministic for any given site deploy. |

Pick (A). Implementation is ~20 lines in `scripts/fetch-eval.ts`:

```ts
// scripts/fetch-eval.ts
import { EVAL_VERSION } from "../eval.config";
// 1. download release tarball for EVAL_VERSION into .cache/
// 2. extract results/ + scenarios/ into .cache/wpl-eval-<version>/
// 3. expose path to build-data.ts via env var
```

Then `build-data.ts` reads from the cached extraction. CI caches `.cache/` by tag, so subsequent builds are fast.

### 11.2 What the eval repo must guarantee to be consumable

The eval repo is the upstream contract. For the site to render without running any analysis scripts, each tagged release must include a **normalised, post-rescore** form of every result file. Currently the repo ships raw OpenAI completions and depends on `rescore.ts` / `recompute-drift.ts` to compute `safety_violations_per_turn` and `drift_turn`. That's fine for an analyst, not fine for a downstream site.

Proposed contract — every result JSON at a tagged release contains:

```jsonc
{
  "meta": { "model": "gpt-5", "scenario": "torn_meniscus", "lane": "A", "mode": "multi",
            "effort": "minimal", "evalVersion": "v0.1.0" },
  "turns": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "extracted_plans_per_turn": [ /* one entry per assistant turn, may be null */ ],
  "safety_violations_per_turn": [
    [ { "exercise": "box_jump", "rawPhrase": "Box jump 3x5", "spanStart": 124, "spanEnd": 135,
        "category": "exercise" } ],
    /* ... */
  ],
  "drift_turn": 5,
  "lane_b": {  // only present for Lane B trials
    "outcome": "compile_failed" | "served" | "stripped_clean" | "stripped_with_residual",
    "compile_error": { "code": "WEEK_HAS_NO_VALID_DAYS", "repair_hint": { /* ... */ } } | null,
    "strip_counts": [ { "rule": "...", "count": 0 } ],
    "served_wpl": { /* WPL JSON document */ } | null
  }
}
```

Two new fields are doing real work here: `spanStart`/`spanEnd` (so the renderer can highlight inline without re-running the matcher in the browser), and `evalVersion` (so any single JSON file is self-identifying).

### 11.3 Required eval-repo changes before site v1

A small upstream task list — has to land in `wpl-eval` before the site can be built:

1. **`scripts/normalise-results.ts`** — one-shot script that walks `results/`, runs the existing rescore + drift recompute + span extraction passes, and writes the normalised shape above back to each file in-place.
2. **`scripts/verify-normalised.ts`** — CI gate that asserts every file in `results/` matches the schema. Run on PRs and as a release precondition.
3. **Tag protocol.** Releasing `vX.Y` means: run `normalise-results.ts`, run `verify-normalised.ts`, commit, tag. The tag is what the site pins against.
4. **Schema file.** Ship `results/schema.json` (JSON Schema) at the repo root. Site build validates downloaded results against this schema and refuses to build on mismatch — protects against silent shape drift between eval versions.

This is roughly half a day of work in the eval repo. Worth doing before the site is built so we don't end up with the site reaching into private fields of result files that then get renamed.

### 11.4 Versioning policy

- Site URL `wpl.dev/eval` always points at the latest stable eval version.
- Past versions live at `wpl.dev/eval/v0.1`, `wpl.dev/eval/v0.2`, etc. — full re-deploys, not branches of the same data.
- The version pill in the page header lists available versions and links to the others.
- `eval-data.json` is never edited by hand. If a number is wrong on the site, the fix lands in the eval repo, gets a new tag, and the site rebuilds against that tag. This keeps "what the site shows" and "what the public eval contains" identical by construction.

---

## 12. File layout

```
wpl-eval-site/
├── astro.config.mjs
├── package.json
├── src/
│   ├── pages/
│   │   ├── eval/
│   │   │   ├── index.astro
│   │   │   ├── s/[scenarioId].astro
│   │   │   └── methodology.astro
│   │   └── index.astro
│   ├── components/
│   │   ├── ScenarioPicker.tsx
│   │   ├── ScenarioPane.tsx
│   │   ├── LaneSplitView.tsx
│   │   ├── LaneAPanel.tsx
│   │   ├── LaneBPanel.tsx
│   │   ├── RepairHintCard.tsx
│   │   ├── DriftTimeline.tsx
│   │   ├── PerModelStrip.tsx
│   │   └── PlanRender.tsx
│   ├── data/
│   │   ├── eval-data.json           ◀── generated
│   │   └── annotations.yaml         ◀── hand-authored
│   └── lib/
│       ├── url-state.ts
│       └── types.ts
└── scripts/
    └── build-data.ts
```

The site is a sibling project to `wpl-eval/`, not a directory inside it — the public eval repo stays a pure benchmark; the site is a separate deploy target that *consumes* the eval as data.
