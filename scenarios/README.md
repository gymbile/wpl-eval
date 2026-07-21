# scenarios/ — the scenario corpus

`scenarios.yaml` defines all 25 trainer-voice client scenarios: 15 v0.5
long-plan, 5 v0.6 short-plan (`block_purpose` structural scoring), and 5
v0.7 lifecycle scenarios (`turn_states[]` state evolution +
`lifecycle_criteria[]` per-turn/per-week checks).

Each scenario carries: `persona`, `presenting` (structured client
facts), `rules` (Lane B product-side governance — authored from the
clinical picture, deliberately independent of the grading key),
`blacklist` (the grading key), prompts for both phases, and
`safety_rationale` with clinical citations. Entries marked `[VERIFY]`
are drafted from non-clinical reading of the cited sources and await
clinician review (scheduled v0.8) — corrigenda welcome via GitHub
issues.

The schema lives in `src/lib/types.ts` (`Scenario`); lifecycle authoring
is validated at load time (`src/lib/lifecycle.ts`), including that every
exercise slug is in the canonical catalog.
