# WPL Production-Readiness Implementation Plan (v0.7 reframe)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every fail-open path in the WPL safety pipeline, ship the contraindication enforcement engine in `@gymbile/wpl-validator` (instead of it living only in the eval repo), reconcile the three divergent action/condition vocabularies, and fix the eval harness's credibility gaps — so WPL is honestly describable as a production AI-safety governance layer.

**Architecture:** Four repos changed in dependency order: (1) `wpl` spec/schema, (2) `wpl-validator-ts` gains a Pass-3 `enforce()` module (rule evaluator + matcher + stripper ported from wpl-eval, made fail-closed), (3) `wpl-ai` compiler made fail-closed on safety paths with a visible `repairs[]` ledger, (4) `wpl-eval` consumes the shipped enforcement instead of its local port and fixes measurement-credibility issues.

**Tech Stack:** TypeScript (strict), vitest, JSON Schema Draft 2020-12, ajv. No new dependencies.

**Repo locations (absolute paths — each is its own git repo):**

| Repo | Path | Current version | Test command |
|---|---|---|---|
| spec/schema | `/Users/alex/Projects/my/gymbile.com/wpl` | schema 1.6.0 (untagged) | CI validates examples; no local test script — use `npx ajv-cli` steps below |
| validator | `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts` | 1.7.1 | `npm test` (vitest) |
| compiler | `/Users/alex/Projects/my/gymbile.com/wpl-ai` | 1.13.0 | `npm test` (vitest, 1227 tests) |
| eval | `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval` | v0.6 | `npm test` (125 tests) |

**Execution rules for the worker:**
1. Work in dependency order: Phase 1 → 2 → 3 → 4 → 5. Within a phase, tasks are ordered.
2. Each repo gets its own feature branch: `git checkout -b v0.7-production-readiness` in that repo before its first task.
3. **NEVER `git push` or `npm publish` without explicit user approval.** Commits on the local branch are fine and expected (one per task step where the plan says Commit).
4. **No Claude/AI attribution in commit messages.** Plain conventional-commit messages only.
5. Cross-repo dependency during development: `wpl-ai` depends on `@gymbile/wpl-validator` and `wpl-eval` depends on both. Until new versions are published, use `npm install /abs/path/to/repo` (file: install) where a task says so. Phase 5 restores registry versions.
6. If a step's expected file content doesn't match reality (line numbers drifted, shape differs), STOP, re-read the actual file, adapt minimally, and note the deviation in the final report. Do not improvise new design.

---

## Phase 1 — `wpl` (spec/schema repo): vocabulary + release hygiene

Branch: `cd /Users/alex/Projects/my/gymbile.com/wpl && git checkout -b v0.7-production-readiness`

### Task 1: Tag the missing v1.6.0 release (hygiene gate)

**Files:** none (git only)

- [ ] **Step 1: Verify the gap**

Run: `cd /Users/alex/Projects/my/gymbile.com/wpl && git tag --list && grep -n "1.6.0" CHANGELOG.md | head -3`
Expected: tags stop at `v1.5.0`; CHANGELOG declares `[1.6.0] — 2026-05-04`.

- [ ] **Step 2: Create the tag at the correct commit**

Find the commit that finalized 1.6.0: `git log --oneline -20 -- CHANGELOG.md` and pick the commit whose message/diff introduces the `[1.6.0]` entry. Then:

```bash
git tag -a v1.6.0 <that-commit-sha> -m "WPL schema 1.6.0"
```

Do **not** push the tag yet — pushing happens in Phase 5 with user approval.

### Task 2: Schema 1.7.0 — condition ops, nested compounds, typed actions, version range

**Files:**
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl/schema/v1.schema.json`

Four surgical edits. The schema is the de-facto spec, so these are the contract changes everything downstream relies on.

- [ ] **Step 1: Add `in`/`not_in` to SimpleCondition**

In `$defs.SimpleCondition.properties.op.enum`, change:

```json
"enum": ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "not_contains"]
```

to:

```json
"enum": ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "not_contains", "in", "not_in"]
```

Rationale: the runtime rule evaluator already supports them (eval `src/lib/rule-evaluator.ts:161-169`) and cycle-day rules use `in`. The schema currently rejects payloads the runtime executes.

- [ ] **Step 2: Allow nested compound conditions**

In `$defs.CompoundCondition.properties.conditions.items`, change:

```json
"items": { "$ref": "#/$defs/SimpleCondition" }
```

to:

```json
"items": { "$ref": "#/$defs/Condition" }
```

- [ ] **Step 3: Type the Action payloads**

Replace the entire `$defs.Action` definition (currently an open object with free-string `type` and `additionalProperties: true`) with:

```json
"Action": {
  "type": "object",
  "required": ["type"],
  "properties": {
    "type": {
      "type": "string",
      "enum": [
        "forbid_exercise", "exclude_exercise", "replace_exercise", "modify_exercise",
        "modify_intensity", "add_warmup_time", "increase_rest",
        "reduce_sets", "reduce_reps", "use_schedule", "add_activity"
      ]
    },
    "scope": {
      "type": "string",
      "enum": ["activity", "block", "day", "week", "phase", "plan"]
    }
  },
  "additionalProperties": true,
  "allOf": [
    {
      "if": { "properties": { "type": { "const": "forbid_exercise" } } },
      "then": {
        "required": ["exercise"],
        "properties": { "exercise": { "type": "string", "minLength": 1 } }
      }
    },
    {
      "if": { "properties": { "type": { "const": "replace_exercise" } } },
      "then": {
        "required": ["from", "to"],
        "properties": {
          "from": { "type": "string", "minLength": 1 },
          "to": { "type": "string", "minLength": 1 }
        }
      }
    },
    {
      "if": { "properties": { "type": { "const": "modify_intensity" } } },
      "then": {
        "required": ["factor"],
        "properties": { "factor": { "type": "number", "exclusiveMinimum": 0, "maximum": 2 } }
      }
    }
  ]
}
```

Notes: `additionalProperties: true` is retained deliberately so future action payloads don't hard-break old validators, but `type` is now a closed enum (unknown action names fail Pass 1) and the three load-bearing payloads are typed. `forbid_exercise` enters the schema for the first time — this is the vocabulary reconciliation.

- [ ] **Step 4: Replace the version const with a 1.x range**

Find `"version"` near the top of the schema (currently `{"const": "1.6.0"}`) and change to:

```json
"version": {
  "type": "string",
  "pattern": "^1\\.[0-9]+\\.[0-9]+$",
  "description": "WPL schema version the plan was authored against. Any 1.x is accepted (additive-only policy); consumers may warn on versions newer than they know."
}
```

This fixes the README compat-promise contradiction (a valid 1.5.0 plan currently fails 1.6.0 validation).

- [ ] **Step 5: Validate schema compiles and all existing fixtures still pass**

```bash
cd /Users/alex/Projects/my/gymbile.com/wpl
npx ajv compile --spec=draft2020 -s schema/v1.schema.json
for f in examples/*.json; do npx ajv validate --spec=draft2020 -s schema/v1.schema.json -d "$f" || echo "FAIL: $f"; done
for f in conformance/valid/*.json; do npx ajv validate --spec=draft2020 -s schema/v1.schema.json -d "$f" || echo "FAIL: $f"; done
```

Expected: schema compiles; all valid fixtures pass (the version pattern accepts their existing `"1.6.0"` strings). If any fixture carries an action with a now-invalid `type`, inspect — that's the reconciliation working; fix the fixture to a valid action type.

- [ ] **Step 6: Commit**

```bash
git add schema/v1.schema.json
git commit -m "feat(schema): 1.7.0 — in/not_in ops, nested compounds, typed actions incl. forbid_exercise, version range"
```

### Task 3: New conformance fixtures for the 1.7.0 surface + `CATALOG_REQUIRED` error code

**Files:**
- Create: `/Users/alex/Projects/my/gymbile.com/wpl/conformance/valid/personalization-forbid-exercise.json`
- Create: `/Users/alex/Projects/my/gymbile.com/wpl/conformance/valid/personalization-nested-compound.json`
- Create: `/Users/alex/Projects/my/gymbile.com/wpl/conformance/invalid/action-unknown-type.json` (+ `.expected.json`)
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl/conformance/error-codes.md`

- [ ] **Step 1: Author the two valid fixtures**

Copy the smallest existing valid fixture that contains a `personalization` block as the base (find one: `grep -l personalization conformance/valid/*.json | head -1`; if none exists, use any minimal valid plan fixture and add the block). Set its `personalization.rules` to:

For `personalization-forbid-exercise.json`:

```json
"personalization": {
  "rules": [
    {
      "id": "forbid_knee_dominant",
      "condition": { "field": "injuries", "op": "contains", "value": "torn_meniscus" },
      "actions": [{ "type": "forbid_exercise", "exercise": "barbell_back_squat", "scope": "plan" }]
    },
    {
      "id": "flow_window_forbid",
      "condition": { "field": "cycle_day", "op": "in", "value": [1, 2, 3] },
      "actions": [{ "type": "forbid_exercise", "exercise": "heavy_deadlift" }]
    }
  ]
}
```

For `personalization-nested-compound.json`:

```json
"personalization": {
  "rules": [
    {
      "id": "nested_compound",
      "condition": {
        "operator": "and",
        "conditions": [
          { "field": "age", "op": "gte", "value": 40 },
          {
            "operator": "or",
            "conditions": [
              { "field": "injuries", "op": "contains", "value": "lumbar_disc" },
              { "field": "experience", "op": "eq", "value": "beginner" }
            ]
          }
        ]
      },
      "actions": [{ "type": "modify_intensity", "factor": 0.8 }]
    }
  ]
}
```

Make sure each fixture is a complete plan (copy all required top-level fields from the base fixture) and `"version"` matches the pattern (use `"1.7.0"`).

- [ ] **Step 2: Author the invalid fixture pair**

`action-unknown-type.json`: same base plan, one rule with `"actions": [{ "type": "frobnicate_exercise" }]`.

`action-unknown-type.expected.json` — match the existing expected-file format exactly (open an existing `conformance/invalid/*.expected.json` to copy the envelope). The expected error is a Pass-1 `SCHEMA_VIOLATION` at the action's path:

```json
{
  "errors": [
    { "code": "SCHEMA_VIOLATION", "path": "/plan/personalization/rules/0/actions/0/type" }
  ]
}
```

Adjust the `path` root (`/plan/...` vs `/...`) to match how existing expected files address personalization — check one first.

- [ ] **Step 3: Validate fixtures with ajv**

```bash
npx ajv validate --spec=draft2020 -s schema/v1.schema.json -d conformance/valid/personalization-forbid-exercise.json
npx ajv validate --spec=draft2020 -s schema/v1.schema.json -d conformance/valid/personalization-nested-compound.json
npx ajv validate --spec=draft2020 -s schema/v1.schema.json -d conformance/invalid/action-unknown-type.json; echo "exit=$? (expect 1)"
```

- [ ] **Step 4: Register the `CATALOG_REQUIRED` error code**

In `conformance/error-codes.md`, add a new code section following the document's existing format (read the `UNRESOLVED_REF` section and mirror its structure):

```markdown
### CATALOG_REQUIRED

Emitted once (path `/plan`) when validation runs in strict catalog mode
(`requireCatalog: true`) and no catalog was supplied while the plan contains
at least one `exercise_ref` / `meal_ref` / `meditation_ref`. Strict mode is
the production posture for safety-governed deployments: entity resolution
must not silently no-op.

Severity: error. Skipped entirely when `requireCatalog` is absent/false
(backward-compatible default).
```

Also add `CATALOG_REQUIRED` to whatever code-listing table exists at the top of the file.

- [ ] **Step 5: Commit**

```bash
git add conformance/
git commit -m "feat(conformance): fixtures for forbid_exercise, nested compounds, unknown action type; CATALOG_REQUIRED code"
```

### Task 4: CHANGELOG 1.7.0 + spec document de-contradiction

**Files:**
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl/CHANGELOG.md`
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl/spec/SPECIFICATION.md`

- [ ] **Step 1: CHANGELOG entry**

Add at the top, matching house style:

```markdown
## [1.7.0] — <today's date>

### Added
- `in` / `not_in` operators on `SimpleCondition` (membership predicates, e.g. cycle-day windows).
- Nested `CompoundCondition` (conditions may now contain compounds, not just simple conditions).
- Closed enum for `Action.type` including `forbid_exercise`; typed payloads for `forbid_exercise` (`exercise`), `replace_exercise` (`from`/`to`), `modify_intensity` (`factor`).
- `CATALOG_REQUIRED` error code for strict catalog mode (see conformance/error-codes.md).

### Changed
- `version` field accepts any `1.x.y` (was `const "1.6.0"`), honoring the additive-only v1 compatibility promise.

### Fixed
- Schema/runtime vocabulary drift: the schema now accepts the personalization payloads the reference rule evaluator executes.
```

- [ ] **Step 2: Fix the stale spec header and the four known contradictions**

In `spec/SPECIFICATION.md`:
1. Header (lines 3-5): set `Version: 1.7.0`, `Status: Living document (schema/v1.schema.json is normative)`, `Last Updated: <today>`.
2. Immediately below the header add a normativity note:

```markdown
> **Normative source:** `schema/v1.schema.json` plus `conformance/` fixtures are
> the contract. Where this prose document and the schema disagree, the schema
> wins. Known prose sections pending rewrite are marked **[STALE]**.
```

3. Mark the four sections the audit found contradicting the schema with a `**[STALE — see schema $defs.X]**` line under their headings: §5.1 ExerciseActivity extras (`category`, `muscle_groups`, `progression`, `alternatives`, `media`, `tracking` — not in schema), §7 notifications-as-object (schema: array), Checkpoint `trigger`/`questionnaire` (schema: `at`/`questions`), `progress.achievements` (not in schema).
4. In the spec's own changelog section, append a `1.7.0` line: "in/not_in, nested compounds, typed actions, version range; prose sections marked STALE pending rewrite."

This is the honest minimal fix — full prose regeneration is out of scope for v0.7.

- [ ] **Step 3: Commit and tag**

```bash
git add CHANGELOG.md spec/SPECIFICATION.md
git commit -m "docs: 1.7.0 changelog; mark stale spec sections, declare schema normative"
git tag -a v1.7.0 -m "WPL schema 1.7.0"
```

(Tag stays local until Phase 5 approval.)

---

## Phase 2 — `wpl-validator-ts` 1.8.0: ship the enforcement engine

Branch: `cd /Users/alex/Projects/my/gymbile.com/wpl-validator-ts && git checkout -b v0.7-production-readiness`

### Task 5: Sync vendored schema to 1.7.0

**Files:**
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/schema/v1.schema.json` (overwrite with the Phase-1 result)
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/schema-version.txt` → `1.7.0`

- [ ] **Step 1: Copy schema**

```bash
cp /Users/alex/Projects/my/gymbile.com/wpl/schema/v1.schema.json /Users/alex/Projects/my/gymbile.com/wpl-validator-ts/schema/v1.schema.json
echo "1.7.0" > /Users/alex/Projects/my/gymbile.com/wpl-validator-ts/schema-version.txt
```

- [ ] **Step 2: Run the suite, fix fixture fallout**

Run: `cd /Users/alex/Projects/my/gymbile.com/wpl-validator-ts && npm test`
Expected: most tests pass. Possible failures: fixtures using action types not in the new enum, or tests asserting the old version const. Fix fixtures to valid action types / keep versions as-is (pattern accepts any 1.x.y). Do NOT weaken the schema to make a test pass — fix the fixture.

- [ ] **Step 3: Commit**

```bash
git add schema/ schema-version.txt tests/ conformance/
git commit -m "chore: sync vendored schema to 1.7.0"
```

### Task 6: Reconcile the Pass-2 action whitelist

**Files:**
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/src/pass2-semantic/rules/invalid-personalization-rule.ts:3-6`
- Test: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/tests/` (add to the existing invalid-personalization-rule test file — find it: `grep -rl "INVALID_PERSONALIZATION_RULE" tests/`)

- [ ] **Step 1: Write the failing test**

In the existing test file for this rule, add (adapt the plan-builder helper the file already uses — read it first and reuse its minimal-plan constructor):

```ts
it('accepts forbid_exercise as a valid action type', () => {
  const plan = basePlanWithRule({
    id: 'r1',
    condition: { field: 'injuries', op: 'contains', value: 'torn_meniscus' },
    actions: [{ type: 'forbid_exercise', exercise: 'barbell_back_squat' }],
  });
  const result = validate(plan);
  const errs = result.errors.filter((e) => e.code === 'INVALID_PERSONALIZATION_RULE');
  expect(errs).toHaveLength(0);
});

it('accepts in/not_in condition ops', () => {
  const plan = basePlanWithRule({
    id: 'r2',
    condition: { field: 'cycle_day', op: 'in', value: [1, 2, 3] },
    actions: [{ type: 'forbid_exercise', exercise: 'heavy_deadlift' }],
  });
  const result = validate(plan);
  expect(result.errors.filter((e) => e.code === 'INVALID_PERSONALIZATION_RULE')).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- invalid-personalization`
Expected: first test FAILS (`forbid_exercise` not in `ACTION_TYPES`).

- [ ] **Step 3: Implement**

In `invalid-personalization-rule.ts`, change the whitelist to:

```ts
const ACTION_TYPES = new Set([
  'forbid_exercise',
  'modify_intensity', 'add_warmup_time', 'increase_rest', 'reduce_sets', 'reduce_reps',
  'replace_exercise', 'exclude_exercise', 'modify_exercise', 'use_schedule', 'add_activity',
]);
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npm test -- invalid-personalization` → PASS. Then full `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pass2-semantic/rules/invalid-personalization-rule.ts tests/
git commit -m "fix: accept forbid_exercise action and in/not_in ops in personalization rules"
```

### Task 7: Strict catalog mode (`CATALOG_REQUIRED`) + case-insensitive ref lookup

**Files:**
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/src/types.ts`
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/src/pass2-semantic/rules/unresolved-ref.ts`
- Test: same rule's test file (`grep -rl "UNRESOLVED_REF" tests/`)

- [ ] **Step 1: Write failing tests**

```ts
it('errors with CATALOG_REQUIRED when requireCatalog is set and no catalog given', () => {
  const plan = planWithExerciseRef('push_up'); // reuse/adapt existing helper
  const result = validate(plan, { requireCatalog: true });
  expect(result.valid).toBe(false);
  expect(result.errors.some((e) => e.code === 'CATALOG_REQUIRED')).toBe(true);
});

it('does not emit CATALOG_REQUIRED when a catalog is provided', () => {
  const plan = planWithExerciseRef('push_up');
  const result = validate(plan, { requireCatalog: true, catalog: { exercises: new Set(['push_up']) } });
  expect(result.errors.some((e) => e.code === 'CATALOG_REQUIRED')).toBe(false);
});

it('resolves refs case-insensitively with a warning-free match', () => {
  const plan = planWithExerciseRef('Push_Up');
  const result = validate(plan, { catalog: { exercises: new Set(['push_up']) } });
  expect(result.errors.some((e) => e.code === 'UNRESOLVED_REF')).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- unresolved` → all three FAIL (unknown option, unknown code, case-sensitive Set lookup).

- [ ] **Step 3: Implement**

`src/types.ts` — add the code and the option:

```ts
export type ErrorCode =
  | 'SCHEMA_VIOLATION'
  | 'DUPLICATE_ID'
  | 'UNRESOLVED_REF'
  | 'CATALOG_REQUIRED'
  | 'EMPTY_PHASES_FOR_TYPE'
  | 'MISSING_EXERCISE_REF'
  | 'INVALID_PRESCRIPTION'
  | 'INVALID_PERSONALIZATION_RULE'
  | 'INVALID_POINTS_RULE'
  | 'PHASE_DURATION_MISMATCH'
  | 'CYCLIC_SUBPLAN'
  | 'ACTIVITY_BLOCK_MISMATCH';
```

```ts
export interface ValidationOptions {
  catalog?: Catalog;
  /**
   * Production posture for safety-governed deployments: when true and no
   * catalog is supplied while the plan contains entity refs, validation
   * fails with CATALOG_REQUIRED instead of silently skipping resolution.
   * Default false (backward compatible).
   */
  requireCatalog?: boolean;
}
```

`src/pass2-semantic/rules/unresolved-ref.ts` — replace the body:

```ts
import type { SemanticRule } from '../walker.js';
import type { Catalog } from '../../types.js';

const REF_KINDS: Array<{ field: string; kind: string; catalogKey: keyof Catalog }> = [
  { field: 'exercise_ref', kind: 'exercise', catalogKey: 'exercises' },
  { field: 'meal_ref', kind: 'meal', catalogKey: 'meals' },
  { field: 'meditation_ref', kind: 'meditation', catalogKey: 'meditations' },
];

// Catalog sets are matched case-insensitively: LLM emitters routinely vary
// casing ("Push_Up" vs "push_up") and a casing miss must not read as
// "exercise does not exist" — that would either fail-open (no catalog) or
// false-positive (catalog present).
function hasRef(set: ReadonlySet<string> | undefined, ref: string): boolean {
  if (!set) return false;
  if (set.has(ref)) return true;
  const lower = ref.toLowerCase();
  for (const entry of set) {
    if (entry.toLowerCase() === lower) return true;
  }
  return false;
}

export const unresolvedRef: SemanticRule = {
  code: 'UNRESOLVED_REF',
  enterActivity(ctx, activity, path) {
    const catalog = ctx.options.catalog;

    for (const { field, kind, catalogKey } of REF_KINDS) {
      const refValue = activity[field];
      if (refValue === undefined) continue;
      if (typeof refValue !== 'string') continue;

      if (!catalog) {
        if (ctx.options.requireCatalog) {
          ctx.emit({
            path: `${path}/${field}`,
            code: 'CATALOG_REQUIRED',
            message: `strict catalog mode: '${refValue}' cannot be resolved because no catalog was supplied`,
            severity: 'error',
            meta: { ref_kind: kind, ref_value: refValue },
          });
        }
        continue;
      }

      if (!hasRef(catalog[catalogKey], refValue)) {
        ctx.emit({
          path: `${path}/${field}`,
          code: 'UNRESOLVED_REF',
          message: `${kind} '${refValue}' not found in catalog`,
          severity: 'error',
          meta: { ref_kind: kind, ref_value: refValue },
        });
      }
    }
  },
};
```

Note: this emits `CATALOG_REQUIRED` per-ref rather than once at `/plan` — simpler with the walker, and strictly more informative. Update the error-codes.md prose in the `wpl` repo accordingly (one-line edit: "Emitted at each unresolvable ref path") — do that now in the wpl repo and amend the Phase-1 conformance commit there:

```bash
cd /Users/alex/Projects/my/gymbile.com/wpl
# edit conformance/error-codes.md CATALOG_REQUIRED section: per-ref path, not /plan
git add conformance/error-codes.md && git commit -m "docs: CATALOG_REQUIRED emitted per-ref"
```

- [ ] **Step 4: Run tests, expect pass**

Run: `cd /Users/alex/Projects/my/gymbile.com/wpl-validator-ts && npm test` → PASS (linear scan in `hasRef` is fine: catalogs are hundreds of entries, refs per plan are dozens).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/pass2-semantic/rules/unresolved-ref.ts tests/
git commit -m "feat: strict catalog mode (CATALOG_REQUIRED) and case-insensitive ref resolution"
```

### Task 8: Port the enforcement types + matcher into the validator

**Files:**
- Create: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/src/enforce/types.ts`
- Create: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/src/enforce/matcher.ts`
- Test: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/tests/enforce-matcher.test.ts`

- [ ] **Step 1: Create `src/enforce/types.ts`**

```ts
// Client + rule types for the Pass-3 enforcement engine. Mirrors the Elixir
// GymbileBackend.WellnessPlans.Personalization.RuleEvaluator field set and the
// schema's $defs.Condition / $defs.Action vocabulary (schema 1.7.0).

export interface Cycle {
  /** ISO-8601 date of cycle day 1 of the most recent period. */
  last_period_start?: string;
  /** Average cycle length in days (required for pattern: "regular"). */
  length_days?: number;
  /** Days at cycle start treated as the flow window. 0/absent = none. */
  flow_days?: number;
  pattern?: 'regular' | 'irregular' | 'suppressed';
  /** Client-reported symptomatic date ranges (projection-independent). */
  flare_windows?: Array<{ start: string; end: string }>;
}

export interface ClientContext {
  weight_kg?: number | null;
  height_cm?: number | null;
  age?: number | null;
  sex?: string | null;
  experience?: string | null;
  injuries?: string[] | null;
  equipment?: string[] | null;
  fatigue?: string | null;
  goals?: string[] | null;
  cycle?: Cycle | null;
  /** Set transiently by enforce() per plan-day; null outside per-day evaluation. */
  cycle_day?: number | null;
}

export type SimpleCondition = {
  field: string;
  op?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'not_contains' | 'in' | 'not_in';
  value?: unknown;
};

export type CompoundCondition = {
  operator?: 'and' | 'or';
  conditions?: Condition[];
};

export type Condition = CompoundCondition | SimpleCondition;

export interface RuleAction {
  type: string;
  [k: string]: unknown;
}

export interface Rule {
  id?: string;
  condition?: Condition | null;
  actions?: RuleAction[];
}

export interface EvaluatedRule {
  rule_id: string;
  condition_met: boolean;
  actions: RuleAction[];
  condition: Condition | null;
}

/** Fail-closed diagnostics: anything the evaluator could not interpret. */
export interface EnforcementDiagnostic {
  code:
    | 'UNKNOWN_CONDITION_FIELD'   // rule references a field not in ClientContext
    | 'UNKNOWN_ACTION_TYPE'       // action type the engine cannot apply
    | 'MALFORMED_RULE';           // rule shape unusable
  rule_id: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface StrippedActivity {
  exercise: string;       // the ref/name that was removed
  matched_rule: string;   // rule_id that forbade it
  path: string;           // JSON pointer to the removed activity
}

export interface EnforcementResult {
  /** Deep-cloned plan with forbidden activities removed. */
  plan: Record<string, unknown>;
  evaluated_rules: EvaluatedRule[];
  stripped: StrippedActivity[];
  diagnostics: EnforcementDiagnostic[];
}

export interface EnforceOptions {
  /** ISO date of plan day 1 — required for cycle_day-conditioned rules. */
  planStartDate?: string;
  /**
   * Extra per-day forbids, projection-independent (e.g. client-reported
   * flare windows). Receives the ISO date of the plan day.
   */
  perDayExtraForbids?: (isoDate: string) => ReadonlySet<string>;
}
```

- [ ] **Step 2: Create `src/enforce/matcher.ts`**

Port from `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/src/scoring/blacklist.ts` lines 1-129 — copy the functions `normalize`, `stemPlural`, `QUALIFIER_TOKENS`, `coreTokens`, `collides` **verbatim** (they are pure and dependency-free; drop the `import type` line and the scoring-only helpers `parseLevel`/`intensityExceeds`/`score`). Export `collides` and `normalize`. Add this header:

```ts
// Fuzzy exercise-name matcher used by the enforcement stripper. Ported from
// wpl-eval src/scoring/blacklist.ts (v0.6) so the shipped stripper removes
// exactly what the published benchmark's scorer would flag. Pure functions,
// no dependencies. Any change here is a behavior change to the safety
// contract — add a conformance fixture with every change.
```

- [ ] **Step 3: Write matcher tests**

Create `tests/enforce-matcher.test.ts` — port the assertions style from wpl-eval's `test/scoring.test.ts` (read it for reference) but write fresh:

```ts
import { describe, it, expect } from 'vitest';
import { collides } from '../src/enforce/matcher.js';

describe('collides', () => {
  it('matches exact and plural variants', () => {
    expect(collides('squat', 'squat')).toBe(true);
    expect(collides('squats', 'squat')).toBe(true);
    expect(collides('barbell back squats', 'barbell_back_squat')).toBe(true);
  });
  it('matches family entries with qualifier suffixes', () => {
    expect(collides('bulgarian split squat', 'bulgarian_split_squat_below_parallel')).toBe(true);
  });
  it('does not over-match sub-families', () => {
    expect(collides('split squat', 'bulgarian_split_squat_below_parallel')).toBe(false);
  });
  it('handles _anything wildcard (any core token)', () => {
    expect(collides('kettlebell swing', 'kettlebell_anything')).toBe(true);
  });
  it('handles _any wildcard (all core tokens)', () => {
    expect(collides('incline dumbbell press', 'dumbbell_press_any')).toBe(true);
    expect(collides('overhead press', 'dumbbell_press_any')).toBe(false);
  });
  it('degenerate blacklist (qualifier-first) only matches exactly', () => {
    expect(collides('deep squat', 'deep_squat')).toBe(true);   // identity
    expect(collides('squat', 'deep_squat')).toBe(false);       // no core tokens
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm test -- enforce-matcher` → PASS (matcher is a verbatim port; if the degenerate case fails, the port diverged — re-copy).

- [ ] **Step 5: Commit**

```bash
git add src/enforce/types.ts src/enforce/matcher.ts tests/enforce-matcher.test.ts
git commit -m "feat(enforce): client/rule types and exercise-name matcher (ported from wpl-eval)"
```

### Task 9: Port the rule evaluator — fail-closed

**Files:**
- Create: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/src/enforce/rule-evaluator.ts`
- Test: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/tests/enforce-rule-evaluator.test.ts`

The source port is `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/src/lib/rule-evaluator.ts` (237 lines). Two **deliberate behavior changes** versus the port (these are the fail-closed fixes — the eval version silently no-ops both):
1. A `SimpleCondition.field` not in the known field map → `UNKNOWN_CONDITION_FIELD` diagnostic (the rule still evaluates to not-met, but the caller can now see a safety rule was disabled).
2. An action whose `type` is missing/not a string → `UNKNOWN_ACTION_TYPE` diagnostic instead of silent `{type: "noop"}`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { evaluateRules, firingActions } from '../src/enforce/rule-evaluator.js';
import type { ClientContext } from '../src/enforce/types.js';

const ctx: ClientContext = { injuries: ['torn_meniscus'], age: 35 };

describe('evaluateRules', () => {
  it('fires a contains rule on injuries', () => {
    const { evaluated } = evaluateRules(
      [{ id: 'r1', condition: { field: 'injuries', op: 'contains', value: 'torn_meniscus' }, actions: [{ type: 'forbid_exercise', exercise: 'pistol_squat' }] }],
      ctx,
    );
    expect(evaluated[0]!.condition_met).toBe(true);
    expect(firingActions(evaluated)).toEqual([{ type: 'forbid_exercise', exercise: 'pistol_squat' }]);
  });

  it('null condition always fires', () => {
    const { evaluated } = evaluateRules([{ id: 'r1', condition: null, actions: [{ type: 'forbid_exercise', exercise: 'x' }] }], ctx);
    expect(evaluated[0]!.condition_met).toBe(true);
  });

  it('missing context field short-circuits to not-met (no crash)', () => {
    const { evaluated } = evaluateRules([{ id: 'r1', condition: { field: 'weight', op: 'lt', value: 60 }, actions: [] }], ctx);
    expect(evaluated[0]!.condition_met).toBe(false);
  });

  it('UNKNOWN_CONDITION_FIELD diagnostic when a rule references a field the engine cannot resolve', () => {
    const { evaluated, diagnostics } = evaluateRules(
      [{ id: 'r1', condition: { field: 'injures', op: 'contains', value: 'torn_meniscus' }, actions: [{ type: 'forbid_exercise', exercise: 'pistol_squat' }] }],
      ctx,
    );
    expect(evaluated[0]!.condition_met).toBe(false); // still conservative on matching
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'UNKNOWN_CONDITION_FIELD', rule_id: 'r1', meta: expect.objectContaining({ field: 'injures' }) }),
    );
  });

  it('UNKNOWN_ACTION_TYPE diagnostic instead of silent noop', () => {
    const { diagnostics } = evaluateRules([{ id: 'r1', condition: null, actions: [{ exercise: 'pistol_squat' } as never] }], ctx);
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_ACTION_TYPE', rule_id: 'r1' }));
  });

  it('in/not_in membership ops', () => {
    const dayCtx: ClientContext = { ...ctx, cycle_day: 2 };
    const { evaluated } = evaluateRules([{ id: 'r1', condition: { field: 'cycle_day', op: 'in', value: [1, 2, 3] }, actions: [] }], dayCtx);
    expect(evaluated[0]!.condition_met).toBe(true);
  });

  it('nested compound conditions', () => {
    const { evaluated } = evaluateRules(
      [{
        id: 'r1',
        condition: {
          operator: 'and',
          conditions: [
            { field: 'age', op: 'gte', value: 30 },
            { operator: 'or', conditions: [{ field: 'injuries', op: 'contains', value: 'torn_meniscus' }, { field: 'experience', op: 'eq', value: 'beginner' }] },
          ],
        },
        actions: [],
      }],
      ctx,
    );
    expect(evaluated[0]!.condition_met).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- enforce-rule-evaluator` → FAIL (module doesn't exist).

- [ ] **Step 3: Implement**

Copy `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/src/lib/rule-evaluator.ts` to `src/enforce/rule-evaluator.ts`, then apply these modifications:

1. Replace the import with `import type { ClientContext, Condition, SimpleCondition, CompoundCondition, RuleAction, EvaluatedRule, Rule, EnforcementDiagnostic } from './types.js';` and delete the now-duplicated local type declarations (`RuleAction`, `EvaluatedRule`, `CompoundCondition`, `SimpleCondition`, `Condition`, `RuleShape` → use `Rule`).
2. Note the schema's CompoundCondition has **no** `type: "compound"` tag — it is discriminated by `operator`/`conditions`. Replace `isCompound` with:

```ts
function isCompound(c: Condition): c is CompoundCondition {
  const cc = c as CompoundCondition & { type?: string };
  return cc.type === 'compound' || cc.operator !== undefined || Array.isArray(cc.conditions);
}
```

(keeps the eval's legacy `type: "compound"` shape working AND accepts the schema shape — order the `isCompound` check before `isSimple` as the original does).

3. Rename the exported `evaluate` to `evaluateRules`, change its signature and add diagnostics:

```ts
export function evaluateRules(
  rules: Rule[] | null | undefined,
  ctx: ClientContext,
): { evaluated: EvaluatedRule[]; diagnostics: EnforcementDiagnostic[] } {
  const diagnostics: EnforcementDiagnostic[] = [];
  const list = Array.isArray(rules) ? rules : [];

  const evaluated = list.map((rule, idx) => {
    const ruleId = rule.id ?? `rule_${idx + 1}`;
    const condition = rule.condition ?? null;
    collectUnknownFields(condition, ruleId, diagnostics);
    const met = conditionMet(condition, ctx);
    const actionsRaw = Array.isArray(rule.actions) ? rule.actions : [];

    const actions: RuleAction[] = [];
    for (const a of actionsRaw) {
      if (a && typeof a === 'object' && !Array.isArray(a) && typeof (a as RuleAction).type === 'string') {
        actions.push(normalizeAction(a));
      } else {
        diagnostics.push({
          code: 'UNKNOWN_ACTION_TYPE',
          rule_id: ruleId,
          message: 'action has no string `type`; it cannot be applied and is ignored',
          meta: { action: a },
        });
      }
    }

    return { rule_id: ruleId, condition_met: met, actions, condition };
  });

  return { evaluated, diagnostics };
}
```

4. Add the unknown-field collector (walks the condition tree; the known-fields list must exactly mirror the `fieldValue` switch):

```ts
const KNOWN_FIELDS = new Set([
  'weight', 'weight_kg', 'height', 'height_cm', 'age', 'sex', 'gender',
  'experience', 'fitness_level', 'injuries', 'contraindications',
  'equipment', 'fatigue', 'goals', 'cycle_day', 'cycle_present',
]);

function collectUnknownFields(
  condition: Condition | null | undefined,
  ruleId: string,
  out: EnforcementDiagnostic[],
): void {
  if (!condition || typeof condition !== 'object') return;
  if (isCompound(condition)) {
    for (const sub of condition.conditions ?? []) collectUnknownFields(sub, ruleId, out);
    return;
  }
  const field = (condition as SimpleCondition).field;
  if (typeof field === 'string' && !KNOWN_FIELDS.has(field)) {
    out.push({
      code: 'UNKNOWN_CONDITION_FIELD',
      rule_id: ruleId,
      message: `condition references field '${field}' which the enforcement engine cannot resolve — this rule can never fire`,
      meta: { field },
    });
  }
}
```

5. Keep `normalizeAction` but it is now only called for actions with a string `type`, so simplify: drop the `out["type"] = "noop"` fallback branch (the type is guaranteed) and drop the `{type:"noop", raw}` non-object branch.
6. Keep everything else (`conditionMet`, `compoundMatch`, `simpleMatch`, `compare`, `stringify`, `fieldValue`, `firingActions`) verbatim. `firingActions` signature stays `(evaluated: EvaluatedRule[]) => RuleAction[]`.

- [ ] **Step 4: Run tests, expect pass**

Run: `npm test -- enforce-rule-evaluator` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/enforce/rule-evaluator.ts tests/enforce-rule-evaluator.test.ts
git commit -m "feat(enforce): fail-closed rule evaluator (unknown fields/actions produce diagnostics)"
```

### Task 10: Cycle helper + the `enforce()` entry point (stripper)

**Files:**
- Create: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/src/enforce/cycle.ts`
- Create: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/src/enforce/index.ts`
- Test: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/tests/enforce.test.ts`

- [ ] **Step 1: Port the cycle helper**

Copy `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/src/lib/cycle.ts` to `src/enforce/cycle.ts`. Change its import of the `Cycle` type to `./types.js`. Keep `computeCycleDay` exported; delete any exports the eval uses for scoring only (read the file — keep it minimal: `computeCycleDay` and whatever it needs). Also port the two date helpers from lane-b: find them via `grep -n "function dayOfWeekOffset\|function dayDateForPlanPosition" /Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/src/lanes/lane-b.ts` and copy both functions verbatim into `src/enforce/cycle.ts`, exporting them.

- [ ] **Step 2: Write the failing enforcement tests**

`tests/enforce.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { enforce } from '../src/enforce/index.js';
import type { ClientContext, Rule } from '../src/enforce/types.js';

// Minimal compiled-WPL shape: plan.phases[].weeks[].days[].blocks[].activities[]
function minimalPlan(activities: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    version: '1.7.0',
    plan: {
      phases: [{
        weeks: [{
          order: 1,
          days: [{ day_of_week: 1, blocks: [{ type: 'main', activities }] }],
        }],
      }],
    },
  };
}

const ctx: ClientContext = { injuries: ['torn_meniscus'] };
const forbidRule: Rule = {
  id: 'forbid_pistol',
  condition: { field: 'injuries', op: 'contains', value: 'torn_meniscus' },
  actions: [{ type: 'forbid_exercise', exercise: 'pistol_squat' }],
};

describe('enforce', () => {
  it('strips a forbidden exercise and records it', () => {
    const plan = minimalPlan([
      { type: 'exercise', exercise_ref: 'pistol_squat' },
      { type: 'exercise', exercise_ref: 'bench_press' },
    ]);
    const result = enforce(plan, ctx, [forbidRule]);
    const acts = (result.plan as any).plan.phases[0].weeks[0].days[0].blocks[0].activities;
    expect(acts).toHaveLength(1);
    expect(acts[0].exercise_ref).toBe('bench_press');
    expect(result.stripped).toEqual([
      expect.objectContaining({ exercise: 'pistol_squat', matched_rule: 'forbid_pistol' }),
    ]);
  });

  it('fuzzy-matches the stripped name like the benchmark scorer', () => {
    const plan = minimalPlan([{ type: 'exercise', name: 'Pistol Squats' }]);
    const result = enforce(plan, ctx, [forbidRule]);
    expect(result.stripped).toHaveLength(1);
  });

  it('does not strip when the condition is not met', () => {
    const plan = minimalPlan([{ type: 'exercise', exercise_ref: 'pistol_squat' }]);
    const result = enforce(plan, { injuries: [] }, [forbidRule]);
    expect(result.stripped).toHaveLength(0);
  });

  it('does not mutate the input plan', () => {
    const plan = minimalPlan([{ type: 'exercise', exercise_ref: 'pistol_squat' }]);
    const snapshot = JSON.stringify(plan);
    enforce(plan, ctx, [forbidRule]);
    expect(JSON.stringify(plan)).toBe(snapshot);
  });

  it('surfaces diagnostics for unenforceable rules', () => {
    const bad: Rule = { id: 'r_typo', condition: { field: 'injures', op: 'contains', value: 'x' }, actions: [{ type: 'forbid_exercise', exercise: 'squat' }] };
    const result = enforce(minimalPlan([]), ctx, [bad]);
    expect(result.diagnostics.some((d) => d.code === 'UNKNOWN_CONDITION_FIELD')).toBe(true);
  });

  it('applies cycle_day-conditioned forbids only on matching dates', () => {
    const cycleCtx: ClientContext = {
      injuries: [],
      cycle: { last_period_start: '2026-01-05', length_days: 28, flow_days: 3, pattern: 'regular' },
    };
    const flowRule: Rule = {
      id: 'flow_forbid',
      condition: { field: 'cycle_day', op: 'in', value: [1, 2, 3] },
      actions: [{ type: 'forbid_exercise', exercise: 'heavy_deadlift' }],
    };
    // plan starts on the period start ⇒ week-1 Monday is cycle day 1 ⇒ strip
    const plan = minimalPlan([{ type: 'exercise', exercise_ref: 'heavy_deadlift' }]);
    const hit = enforce(plan, cycleCtx, [flowRule], { planStartDate: '2026-01-05' });
    expect(hit.stripped).toHaveLength(1);
    // plan starts mid-cycle (day 10) ⇒ no strip
    const miss = enforce(plan, cycleCtx, [flowRule], { planStartDate: '2026-01-14' });
    expect(miss.stripped).toHaveLength(0);
  });
});
```

Note for the worker: the exact date arithmetic of the cycle test depends on `dayOfWeekOffset`/`dayDateForPlanPosition` semantics — read those two ported functions first and adjust `day_of_week` / dates in the test so the intended cycle days (1 vs 10) actually result. The *assertion logic* (strip on flow day, no strip off flow day) is the contract; the literal dates may need tuning.

- [ ] **Step 3: Run to verify failure** — `npm test -- tests/enforce.test` → FAIL (no module).

- [ ] **Step 4: Implement `src/enforce/index.ts`**

This is the port of `stripForbidden` + the per-day-forbids wiring from `wpl-eval/src/lanes/lane-b.ts:363-536`, generalized (rules come from the caller, not from a scenario blacklist):

```ts
// Pass-3 enforcement: evaluate personalization rules against a client
// context and strip forbidden activities from a compiled WPL plan.
//
// This is the runtime half of the WPL safety contract. Pass 1/2 (validate())
// check that a plan is well-formed; enforce() makes the plan safe *for this
// client*. Ported from the wpl-eval Lane B runtime (v0.6) so the shipped
// engine matches the published benchmark, with fail-closed diagnostics added.

import { evaluateRules, firingActions } from './rule-evaluator.js';
import { collides } from './matcher.js';
import { computeCycleDay, dayOfWeekOffset, dayDateForPlanPosition } from './cycle.js';
import type {
  ClientContext, Rule, RuleAction, EnforcementResult, EnforcementDiagnostic,
  EnforceOptions, StrippedActivity, EvaluatedRule,
} from './types.js';

const APPLICABLE_ACTIONS = new Set(['forbid_exercise']);

function forbiddenExercises(actions: RuleAction[]): Map<string, string> {
  // exercise → rule_id that forbade it (first wins, for attribution)
  const out = new Map<string, string>();
  for (const a of actions) {
    if (a.type === 'forbid_exercise' && typeof a['exercise'] === 'string') {
      const ex = a['exercise'] as string;
      if (!out.has(ex)) out.set(ex, (a['__rule_id'] as string) ?? 'unknown_rule');
    }
  }
  return out;
}

// Tag each firing action with its rule id so stripped entries are attributable.
function tagged(evaluated: EvaluatedRule[]): RuleAction[] {
  return evaluated.flatMap((r) =>
    r.condition_met ? r.actions.map((a) => ({ ...a, __rule_id: r.rule_id })) : [],
  );
}

function activityName(act: Record<string, unknown>): string {
  if (typeof act['exercise_ref'] === 'string') return act['exercise_ref'] as string;
  if (typeof act['name'] === 'string') return act['name'] as string;
  return '';
}

function matchForbid(name: string, forbids: ReadonlyMap<string, string>): string | null {
  if (!name) return null;
  for (const [pattern, ruleId] of forbids) {
    if (collides(name, pattern)) return ruleId;
  }
  return null;
}

export function enforce(
  planJson: Record<string, unknown>,
  ctx: ClientContext,
  rules: Rule[],
  options: EnforceOptions = {},
): EnforcementResult {
  const diagnostics: EnforcementDiagnostic[] = [];
  const stripped: StrippedActivity[] = [];

  // Static pass: rules evaluated against the bare context (cycle_day null —
  // cycle-conditioned rules short-circuit and are handled per-day below).
  const staticEval = evaluateRules(rules, ctx);
  diagnostics.push(...staticEval.diagnostics);
  const staticForbids = forbiddenExercises(tagged(staticEval.evaluated));

  // Report rule actions the engine has no applicator for (visible, not silent).
  for (const r of staticEval.evaluated) {
    for (const a of r.actions) {
      if (!APPLICABLE_ACTIONS.has(a.type)) {
        diagnostics.push({
          code: 'UNKNOWN_ACTION_TYPE',
          rule_id: r.rule_id,
          message: `action type '${a.type}' has no enforcement applicator yet — it is reported but not applied`,
          meta: { action_type: a.type },
        });
      }
    }
  }

  const clone = JSON.parse(JSON.stringify(planJson)) as Record<string, unknown>;
  const plan = clone['plan'];
  if (!plan || typeof plan !== 'object') {
    return { plan: clone, evaluated_rules: staticEval.evaluated, stripped, diagnostics };
  }

  const usesCycle = !!ctx.cycle && !!options.planStartDate;
  const phases = Array.isArray((plan as Record<string, unknown>)['phases'])
    ? ((plan as Record<string, unknown>)['phases'] as Record<string, unknown>[])
    : [];

  let weeksBeforePhase = 0;
  for (let pi = 0; pi < phases.length; pi++) {
    const phase = phases[pi]!;
    const weeks = Array.isArray(phase['weeks']) ? (phase['weeks'] as Record<string, unknown>[]) : [];
    for (let wi = 0; wi < weeks.length; wi++) {
      const week = weeks[wi]!;
      const weekOrder = typeof week['order'] === 'number' ? (week['order'] as number) : wi + 1;
      const days = Array.isArray(week['days']) ? (week['days'] as Record<string, unknown>[]) : [];
      for (let di = 0; di < days.length; di++) {
        const day = days[di]!;

        // Per-day forbids: cycle_day-conditioned rules + caller extras.
        let forbids: ReadonlyMap<string, string> = staticForbids;
        if (usesCycle || options.perDayExtraForbids) {
          const dowOffset = dayOfWeekOffset(day['day_of_week'] as string | number | undefined);
          if (dowOffset !== null && options.planStartDate) {
            const date = dayDateForPlanPosition(options.planStartDate, weeksBeforePhase, weekOrder, dowOffset);
            const dyn = new Map(staticForbids);
            if (usesCycle) {
              const cd = computeCycleDay(date, ctx.cycle!);
              const dayEval = evaluateRules(rules, { ...ctx, cycle_day: cd });
              for (const [ex, rid] of forbiddenExercises(tagged(dayEval.evaluated))) {
                if (!dyn.has(ex)) dyn.set(ex, rid);
              }
            }
            if (options.perDayExtraForbids) {
              for (const ex of options.perDayExtraForbids(date)) {
                if (!dyn.has(ex)) dyn.set(ex, 'per_day_extra');
              }
            }
            forbids = dyn;
          }
        }
        if (forbids.size === 0) continue;

        const blocks = Array.isArray(day['blocks']) ? (day['blocks'] as Record<string, unknown>[]) : [];
        for (let bi = 0; bi < blocks.length; bi++) {
          const block = blocks[bi]!;
          const activities = Array.isArray(block['activities'])
            ? (block['activities'] as Record<string, unknown>[])
            : [];
          const kept: Record<string, unknown>[] = [];
          for (let ai = 0; ai < activities.length; ai++) {
            const act = activities[ai]!;
            const name = activityName(act);
            const ruleId = matchForbid(name, forbids);
            if (ruleId === null) {
              kept.push(act);
            } else {
              stripped.push({
                exercise: name,
                matched_rule: ruleId,
                path: `/plan/phases/${pi}/weeks/${wi}/days/${di}/blocks/${bi}/activities/${ai}`,
              });
            }
          }
          block['activities'] = kept;
        }
      }
    }
    weeksBeforePhase += weeks.length;
  }

  return { plan: clone, evaluated_rules: staticEval.evaluated, stripped, diagnostics };
}

export { evaluateRules, firingActions } from './rule-evaluator.js';
export { collides } from './matcher.js';
export { computeCycleDay } from './cycle.js';
export type * from './types.js';
```

- [ ] **Step 5: Export from the package root**

In `src/index.ts` add at the bottom:

```ts
export { enforce, evaluateRules, firingActions, collides } from './enforce/index.js';
export type {
  ClientContext, Cycle, Rule, RuleAction, Condition, SimpleCondition, CompoundCondition,
  EvaluatedRule, EnforcementResult, EnforcementDiagnostic, StrippedActivity, EnforceOptions,
} from './enforce/types.js';
```

- [ ] **Step 6: Run tests** — `npm test` → all PASS (tune the cycle-test dates per the Step-2 note if needed). Then `npm run typecheck` → clean. Then `npm run build` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/enforce/ src/index.ts tests/enforce.test.ts
git commit -m "feat(enforce): enforce() entry point — rule evaluation + forbidden-exercise stripping with attribution"
```

### Task 11: Enforcement conformance fixtures — "a contraindicated exercise must not survive"

**Files:**
- Create: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/conformance/enforcement/README.md`
- Create: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/conformance/enforcement/forbid-static.json`
- Create: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/conformance/enforcement/forbid-fuzzy-name.json`
- Create: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/conformance/enforcement/forbid-condition-not-met.json`
- Create: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/conformance/enforcement/forbid-unknown-field-diagnostic.json`
- Create: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/conformance/enforcement/forbid-cycle-window.json`
- Test: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/tests/enforcement-conformance.test.ts`

- [ ] **Step 1: Define the fixture format (README)**

```markdown
# Enforcement conformance fixtures

Each fixture is a single JSON file:

​```json
{
  "description": "what this asserts",
  "plan": { ...compiled WPL JSON... },
  "context": { ...ClientContext... },
  "rules": [ ...personalization rules... ],
  "options": { "planStartDate": "..." },
  "expect": {
    "stripped_exercises": ["pistol_squat"],
    "surviving_refs": ["bench_press"],
    "diagnostic_codes": []
  }
}
​```

The contract: after `enforce(plan, context, rules, options)`,
- every entry in `expect.stripped_exercises` appears in `result.stripped[].exercise`,
- every entry in `expect.surviving_refs` still appears somewhere in the output plan's activities,
- NO stripped exercise appears anywhere in the output plan (the invariant),
- `expect.diagnostic_codes` exactly matches the set of `result.diagnostics[].code`.

Cross-implementation: the Elixir enforcement port must pass these same fixtures.
```

(Strip the zero-width escapes around the code fence when writing the file.)

- [ ] **Step 2: Author the five fixtures**

Each uses the same minimal plan shape as the Task-10 tests. Concretely, `forbid-static.json`:

```json
{
  "description": "static injury-conditioned forbid strips the contraindicated exercise",
  "plan": {
    "version": "1.7.0",
    "plan": {
      "phases": [{ "weeks": [{ "order": 1, "days": [{ "day_of_week": 1, "blocks": [{ "type": "main", "activities": [
        { "type": "exercise", "exercise_ref": "pistol_squat" },
        { "type": "exercise", "exercise_ref": "bench_press" }
      ] }] }] }] }]
    }
  },
  "context": { "injuries": ["torn_meniscus"] },
  "rules": [{
    "id": "forbid_pistol",
    "condition": { "field": "injuries", "op": "contains", "value": "torn_meniscus" },
    "actions": [{ "type": "forbid_exercise", "exercise": "pistol_squat" }]
  }],
  "expect": {
    "stripped_exercises": ["pistol_squat"],
    "surviving_refs": ["bench_press"],
    "diagnostic_codes": []
  }
}
```

The other four follow the same envelope:
- `forbid-fuzzy-name.json`: activity `{ "type": "exercise", "name": "Bulgarian Split Squats" }`, rule forbids `bulgarian_split_squat_below_parallel`, expect stripped `["Bulgarian Split Squats"]`, surviving `[]`, no diagnostics.
- `forbid-condition-not-met.json`: same as static but `"context": { "injuries": [] }`; expect stripped `[]`, surviving `["pistol_squat", "bench_press"]`, no diagnostics.
- `forbid-unknown-field-diagnostic.json`: rule condition field `"injures"` (typo); expect stripped `[]`, surviving `["pistol_squat"]`, diagnostic_codes `["UNKNOWN_CONDITION_FIELD"]`.
- `forbid-cycle-window.json`: cycle context + `cycle_day in [1,2,3]` rule + `"options": {"planStartDate": "<date that makes week-1 day 1 fall on cycle day 1>"}` (reuse the tuned dates from the Task-10 cycle test); expect the heavy_deadlift stripped.

- [ ] **Step 3: Write the conformance runner test**

`tests/enforcement-conformance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { enforce } from '../src/enforce/index.js';

const DIR = join(__dirname, '..', 'conformance', 'enforcement');

function collectActivityNames(plan: Record<string, unknown>): string[] {
  const names: string[] = [];
  const p = plan['plan'] as Record<string, unknown> | undefined;
  for (const phase of ((p?.['phases'] as any[]) ?? [])) {
    for (const week of (phase.weeks ?? [])) {
      for (const day of (week.days ?? [])) {
        for (const block of (day.blocks ?? [])) {
          for (const act of (block.activities ?? [])) {
            const n = act.exercise_ref ?? act.name;
            if (typeof n === 'string') names.push(n);
          }
        }
      }
    }
  }
  return names;
}

describe('enforcement conformance', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
  expect(files.length).toBeGreaterThanOrEqual(5);

  for (const file of files) {
    it(file, () => {
      const fx = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
      const result = enforce(fx.plan, fx.context, fx.rules, fx.options ?? {});
      const surviving = collectActivityNames(result.plan);

      for (const ex of fx.expect.stripped_exercises) {
        expect(result.stripped.map((s: any) => s.exercise)).toContain(ex);
        expect(surviving).not.toContain(ex); // THE invariant
      }
      for (const ref of fx.expect.surviving_refs) {
        expect(surviving).toContain(ref);
      }
      expect([...new Set(result.diagnostics.map((d: any) => d.code))].sort())
        .toEqual([...fx.expect.diagnostic_codes].sort());
    });
  }
});
```

- [ ] **Step 4: Run** — `npm test -- enforcement-conformance` → PASS (tune fixture dates if the cycle one fails, per Task 10 note).

- [ ] **Step 5: Commit**

```bash
git add conformance/enforcement/ tests/enforcement-conformance.test.ts
git commit -m "feat(conformance): enforcement fixtures — contraindicated exercises must not survive"
```

### Task 12: Validator release prep — CHANGELOG backfill + 1.8.0

**Files:**
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/CHANGELOG.md`
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/package.json` (version → `1.8.0`)
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ts/README.md`

- [ ] **Step 1: Backfill the missing entries**

The CHANGELOG stops at 1.6.6 but the package is 1.7.1. Reconstruct from git: `git log v1.6.6..v1.7.1 --oneline` (tags exist per the audit; if tag names differ, `git tag --list`). Write entries for 1.6.7 (DUPLICATE_ID scoping change), 1.7.0 (`RepairHint` type + `getRepairHints` export), 1.7.1 (whatever the log shows) in house style.

- [ ] **Step 2: Add the 1.8.0 entry**

```markdown
## [1.8.0] — <today>

### Added
- **Pass-3 enforcement engine**: `enforce(plan, context, rules, options)` evaluates
  personalization rules against a `ClientContext` and strips forbidden exercises
  from the compiled plan, with per-activity attribution (`stripped[]`) and
  fail-closed diagnostics (`UNKNOWN_CONDITION_FIELD`, `UNKNOWN_ACTION_TYPE`).
  Ported from the wpl-eval Lane B runtime so the shipped engine matches the
  published v0.6 benchmark. Exports: `enforce`, `evaluateRules`, `firingActions`,
  `collides`, `computeCycleDay` + types.
- Enforcement conformance fixtures (`conformance/enforcement/`) — the
  "contraindicated exercise must not survive" invariant is now a tested contract.
- Strict catalog mode: `validate(plan, { requireCatalog: true })` fails with
  `CATALOG_REQUIRED` instead of silently skipping entity resolution.
- `forbid_exercise` accepted by INVALID_PERSONALIZATION_RULE; `in`/`not_in`
  condition ops; nested compound conditions (schema 1.7.0 sync).

### Changed
- Catalog ref resolution is case-insensitive.
- Vendored schema: 1.7.0.
```

- [ ] **Step 3: README** — add an "Enforcement (Pass 3)" section with the `enforce()` example from the 1.8.0 entry (a 10-line usage snippet showing plan + context + one forbid rule + reading `result.stripped`). Set `package.json` version to `1.8.0`.

- [ ] **Step 4: Full check** — `npm test && npm run typecheck && npm run build` → all green.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md package.json README.md
git commit -m "chore(release): 1.8.0 — enforcement engine, strict catalog mode, changelog backfill"
```

---

## Phase 3 — `wpl-ai` 2.0.0: fail-closed compiler

Branch: `cd /Users/alex/Projects/my/gymbile.com/wpl-ai && git checkout -b v0.7-production-readiness`

First, wire the local validator: `npm install /Users/alex/Projects/my/gymbile.com/wpl-validator-ts` (file: install for development; Phase 5 restores the registry version). Run `npm test` to establish the green baseline (1227 tests).

**Major-version rationale:** Tasks 14 and 16 convert silent acceptance into hard errors — a breaking behavior change for consumers that relied on tolerant compiles. This is 2.0.0.

### Task 13: The `repairs[]` ledger — make every silent mutation visible

**Files:**
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-ai/src/types.ts` (add `Repair`)
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-ai/src/parser.ts` (ParseState + recording)
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-ai/src/index.ts` (thread through CompileResult)
- Test: `/Users/alex/Projects/my/gymbile.com/wpl-ai/__tests__/repairs.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/repairs.test.ts` (mirror import style of an existing test file — read `__tests__/` for the established pattern of building DSL strings and calling `compileWplAi`):

```ts
import { describe, it, expect } from "vitest";
import { compileWplAi } from "../src/index.js";

// A minimal valid plan body to append safety-relevant sections to. Read an
// existing passing fixture in __tests__ for the canonical minimal DSL and
// reuse it here as MINIMAL_PLAN — it must compile ok with zero repairs.
import { MINIMAL_PLAN } from "./helpers/minimal-plan.js"; // create this helper from an existing fixture

describe("repairs ledger", () => {
  it("baseline compiles with empty repairs", () => {
    const r = compileWplAi(MINIMAL_PLAN);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.repairs).toEqual([]);
  });

  it("records a skipped unknown (non-safety) section", () => {
    const r = compileWplAi(MINIMAL_PLAN + "\nSUMMARY:\n  great plan\n");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.repairs).toContainEqual(
        expect.objectContaining({ type: "skipped_section", section: "SUMMARY" }),
      );
    }
  });

  it("records an exercise auto-substitution with from/to", () => {
    // 'pushup' is a known Jaro-Winkler ≥0.85 correction to 'push_up'
    const src = MINIMAL_PLAN.replace(/\b(push_up|bench_press|squat)\b/, "pushup");
    const r = compileWplAi(src);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.repairs).toContainEqual(
        expect.objectContaining({ type: "exercise_substitution", from: "pushup", to: "push_up" }),
      );
    }
  });

  it("records a defaulted value when a lenient expect* fabricates one", () => {
    // a deadline that is not a date forces expectDate's lenient default
    const r = compileWplAi(MINIMAL_PLAN.replace(/deadline [0-9-]+/, "deadline soonish"));
    // if MINIMAL_PLAN has no deadline, add one valid first then corrupt it —
    // adapt to the fixture; the contract under test is:
    if (r.ok) {
      expect(r.repairs.some((rep) => rep.type === "defaulted_value")).toBe(true);
    }
  });
});
```

Worker note: the exact MINIMAL_PLAN DSL and the substitution trigger word must be adapted from the real fixtures/`ALL_EXERCISES` — the contract (repairs entries with these `type` values) is what matters. Build `__tests__/helpers/minimal-plan.ts` by extracting the smallest DSL string that an existing test already proves compiles.

- [ ] **Step 2: Run to verify failure** — `npx vitest run __tests__/repairs.test.ts` → FAIL (`repairs` doesn't exist).

- [ ] **Step 3: Implement the type and plumbing**

`src/types.ts` — add:

```ts
/**
 * A repair is anything the tolerant parser changed or dropped on the way to
 * a successful compile. Repairs NEVER include safety-section deletions or
 * contraindication downgrades — those are hard errors (fail closed). The
 * ledger exists so an orchestrator (or a human reviewing an AI-generated
 * plan) can see every silent normalization that occurred.
 */
export interface Repair {
  type:
    | "skipped_section"        // unknown ALL-CAPS section dropped (section: name)
    | "skipped_block"          // malformed day-level activity block dropped
    | "exercise_substitution"  // fuzzy ref correction (from, to, similarity)
    | "unknown_exercise"       // ref kept verbatim but absent from catalog (ref)
    | "defaulted_value"        // lenient expect* fabricated a value (expected, got, defaulted_to)
    | "discarded_modifier";    // simple-activity modifier value dropped
  message: string;
  line?: number;
  column?: number;
  [k: string]: unknown;
}
```

`src/parser.ts`:
1. `interface ParseState` gains `repairs: Repair[];` (import the type). Update the `parse()` entry point where ParseState is constructed (find: `grep -n "errors: \[\]" src/parser.ts`) to initialize `repairs: []`.
2. Add next to `addError`:

```ts
function addRepair(state: ParseState, repair: Repair): void {
  state.repairs.push(repair);
}
```

3. The parse result: find the `parse()` return type (`ParseResult` in src/types.ts or parser.ts) and add `repairs: Repair[]` to the ok-variant; return `state.repairs`.

`src/index.ts` — `CompileResult` ok-variant gains `repairs: Repair[];` and `compileWplAi` passes `parseResult.repairs` through:

```ts
return {
  ok: true,
  json: compileResult.json,
  ast: parseResult.document,
  warnings,
  repairs: parseResult.repairs,
  validation,
  pointerMap: compileResult.pointerMap,
};
```

4. Record the existing silent mutations at their sites (these all exist today as silent code paths — the audit located them):
   - **Unknown-section skip** (`parseSections` default case, src/parser.ts:485-514): inside the `if (/^[A-Z_]+$/.test(val))` branch, before skipping, add `addRepair(state, { type: "skipped_section", section: val, message: \`unknown section '${val}' skipped\`, line: tok.location.line, column: tok.location.column });` (Task 14 carves the safety exception out of this same branch).
   - **Fuzzy substitution** (`resolveExerciseRef`, src/parser.ts:2493-2501): when `best !== null`, `addRepair(state, { type: "exercise_substitution", from: ref, to: best, message: \`'${ref}' auto-corrected to '${best}'\` }); return best;`.
   - **Unknown exercise kept** (same function, tier-2 fallback): `addRepair(state, { type: "unknown_exercise", ref, message: \`'${ref}' is not in the exercise catalog; kept verbatim\` }); return ref;` (replaces the `void state; void result;` lines).
   - **Day-level block skip** (src/parser.ts:2106-2144): where the malformed block is consumed, add `addRepair(state, { type: "skipped_block", message: "malformed day-level activity block dropped" })` with the block's token location.
   - **Discarded simple-activity modifiers** (`consumeSimpleActivityModifiers`, src/parser.ts:2447-2453 area): add a `discarded_modifier` repair naming the modifier.
   - **Lenient expect helpers** (src/parser.ts:4755-4835): each `expect*` that returns a fabricated default on mismatch gets a repair before returning, e.g. in `expectNumber`: `addRepair(state, { type: "defaulted_value", expected: "number", got: tok.type, defaulted_to: 0, message: "expected a number; defaulted to 0", line: tok.location.line, column: tok.location.column }); return 0;`. Same pattern for `expectString` (`""`), `expectDate` (keep today's date as the default — changing it would break downstream schema/date logic — but it is now *recorded*), `expectTime` (`"00:00"`), `expectBoolean` (`false`), `expectEnabledDisabled` (`false`), `expectBareWord` (stringified token). These helpers need access to `state` — they already take it.

- [ ] **Step 4: Run the new tests AND the full suite**

`npx vitest run __tests__/repairs.test.ts` → PASS. `npm test` → all 1227 pass (repairs are additive; nothing asserts on their absence). If any test constructed a `CompileResult` literal, add `repairs: []`.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/parser.ts src/index.ts __tests__/repairs.test.ts __tests__/helpers/
git commit -m "feat: repairs[] ledger — every silent parser normalization is now recorded"
```

### Task 14: Fail closed on safety-adjacent unknown sections (C1)

**Files:**
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-ai/src/parser.ts` (the `parseSections` default case)
- Test: `/Users/alex/Projects/my/gymbile.com/wpl-ai/__tests__/safety-sections.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { compileWplAi } from "../src/index.js";
import { MINIMAL_PLAN } from "./helpers/minimal-plan.js";

const CONTRA_BLOCK = "\n  contraindication lower_back_injury severity high action require_clearance\n";

describe("safety-adjacent unknown sections fail closed", () => {
  for (const name of ["REQUIREMENTS", "CONTRAINDICATIONS", "SAFETY", "SAFETY_NOTES", "PRECAUTIONS"]) {
    it(`${name}: compile fails instead of silently dropping the section`, () => {
      const r = compileWplAi(MINIMAL_PLAN + `\n${name}:` + CONTRA_BLOCK);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors.some((e) => /REQUIRES/.test(e.message))).toBe(true); // error must point at the canonical section
      }
    });
  }

  it("non-safety unknown sections still skip tolerantly (with a repair)", () => {
    const r = compileWplAi(MINIMAL_PLAN + "\nSUMMARY:\n  nice plan\n");
    expect(r.ok).toBe(true);
  });

  it("the canonical REQUIRES section still parses", () => {
    const r = compileWplAi(MINIMAL_PLAN + "\nREQUIRES:" + CONTRA_BLOCK);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.stringify(r.json)).toContain("lower_back_injury");
    }
  });
});
```

- [ ] **Step 2: Run to verify failure** — the five fail-closed cases FAIL (today they compile ok).

- [ ] **Step 3: Implement**

In the `parseSections` default case (src/parser.ts:485-514), before the tolerant skip, add:

```ts
// Fail closed on safety-adjacent section names. A one-character typo in
// REQUIRES must not silently erase the plan's entire safety contract —
// that exact failure mode shipped in <=1.13 (a plural-form `REQUIREMENTS:`
// deleted all contraindications with zero warnings).
const SAFETY_SECTION_RE = /^(REQUIRE|CONTRA|SAFETY|PRECAUTION|MEDICAL|CLEARANCE)/;
if (SAFETY_SECTION_RE.test(val) ) {
  addError(state, {
    // copy the exact ParseError construction shape from a neighboring
    // addError call site in this file (code/message/location fields)
    ...parseErrorAt(state, tok),
    message: `unknown section '${val}' looks safety-related — did you mean 'REQUIRES'? Refusing to skip it silently.`,
  });
  return sections;
}
```

Worker note: `parseErrorAt` is illustrative — read two existing `addError(state, {...})` call sites in parser.ts and construct the error object with the same fields/`code` conventions they use (there are only 12 call sites; `grep -n "addError(state" src/parser.ts`). The behavioral contract is: compile must return `ok: false` with an error message naming `REQUIRES`.

- [ ] **Step 4: Run** — `npx vitest run __tests__/safety-sections.test.ts` → PASS; full `npm test` → check for fixtures that legitimately used sections like `CONTRAINDICATIONS:` expecting tolerant skip; fix those fixtures to use `REQUIRES:` (they were relying on the bug).

- [ ] **Step 5: Commit**

```bash
git add src/parser.ts __tests__/safety-sections.test.ts
git commit -m "feat!: unknown safety-adjacent sections (REQUIRE*/CONTRA*/SAFETY*...) are hard errors"
```

### Task 15: Unknown exercise refs surface as semantic warnings (C3)

**Files:**
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-ai/src/validator.ts` (the `validateActivityValues` exercise branch, around lines 246-255)
- Test: `/Users/alex/Projects/my/gymbile.com/wpl-ai/__tests__/unknown-exercise-warning.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { compileWplAi } from "../src/index.js";
import { MINIMAL_PLAN } from "./helpers/minimal-plan.js";

describe("unknown exercise refs produce a semantic warning", () => {
  it("jefferson_curl (real but uncataloged) compiles WITH a warning", () => {
    const src = MINIMAL_PLAN.replace(/\b(push_up|bench_press|squat)\b/, "jefferson_curl");
    const r = compileWplAi(src);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.some((w) => /jefferson_curl/.test(w.message) && /catalog|known exercise/.test(w.message))).toBe(true);
    }
  });

  it("known exercises produce no such warning", () => {
    const r = compileWplAi(MINIMAL_PLAN);
    if (r.ok) {
      expect(r.warnings.filter((w) => /catalog|known exercise/.test(w.message))).toHaveLength(0);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure** — first test FAILS (no warning exists today; the code comment claims it does — audit C3).

- [ ] **Step 3: Implement**

In `src/validator.ts`, in the activity-values validation for `kind: "exercise"` (read the function — it currently only checks weight units), add a catalog check. The validator walks the AST and has each activity's name + source range; use the same warning-emission pattern as the surrounding code:

```ts
import { isKnownExercise } from "./exercises.js";
import { CARDIO_MODALITY_SET } from /* wherever parser imports it from — find with grep */;

// inside the exercise-activity branch:
if (!isKnownExercise(activity.exercise_ref) && !CARDIO_MODALITY_SET.has(activity.exercise_ref)) {
  warnings.push({
    severity: "warning",
    message: `'${activity.exercise_ref}' is not a known exercise in the catalog — it cannot be checked against contraindications by name-insensitive consumers; verify it is intentional`,
    line: /* activity range */, column: /* */, length: /* */,
  });
}
```

Worker note: exact property names (`exercise_ref` on the AST node, how ranges attach) must come from reading the AST types in src/types.ts and the existing warning emissions in validator.ts. Don't warn on activities that were already auto-substituted (they resolve to known refs) — only tier-2 passthroughs hit this.

- [ ] **Step 4: Run** — new tests PASS; full `npm test` → fixtures using uncataloged exercises will now carry warnings; only fix tests that assert `warnings.length === 0` globally (change to filter by message), never weaken the warning.

- [ ] **Step 5: Commit**

```bash
git add src/validator.ts __tests__/unknown-exercise-warning.test.ts
git commit -m "feat: semantic warning for exercise refs absent from the catalog"
```

### Task 16: Contraindication typos are hard errors (C4) + affects resolution (H1)

**Files:**
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-ai/src/parser.ts` (`parseContraindication`, lines 987-1045)
- Test: `/Users/alex/Projects/my/gymbile.com/wpl-ai/__tests__/contraindication-strict.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { compileWplAi } from "../src/index.js";
import { MINIMAL_PLAN } from "./helpers/minimal-plan.js";

const REQ = (body: string) => MINIMAL_PLAN + "\nREQUIRES:\n  " + body + "\n";

describe("contraindication parsing is strict", () => {
  it("unknown action is a hard error, not a downgrade to exclude", () => {
    const r = compileWplAi(REQ("contraindication lower_back_injury action require_clearence"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /require_clearence/.test(e.message))).toBe(true);
  });

  it("unknown severity is a hard error, not silently dropped", () => {
    const r = compileWplAi(REQ("contraindication lower_back_injury severity hgh action exclude"));
    expect(r.ok).toBe(false);
  });

  it("valid contraindication still parses with severity and action intact", () => {
    const r = compileWplAi(REQ("contraindication lower_back_injury severity high action require_clearance"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const s = JSON.stringify(r.json);
      expect(s).toContain('"severity":"high"');
      expect(s).toContain('"require_clearance"');
    }
  });

  it("affects entries are resolved like exercise refs (typo corrected + recorded)", () => {
    const r = compileWplAi(REQ("contraindication knee_injury action exclude\n    affects [pistol_squat, pushup]"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.stringify(r.json)).toContain("push_up"); // pushup → push_up, same machinery as body refs
      expect(r.repairs).toContainEqual(expect.objectContaining({ type: "exercise_substitution", from: "pushup", to: "push_up" }));
    }
  });
});
```

Worker note: verify the `affects` DSL syntax against an existing passing contraindication fixture (`grep -rn "affects" __tests__/ | head`) and adapt the test's DSL to the real grammar.

- [ ] **Step 2: Run to verify failure** — typo tests FAIL (today they compile ok with downgraded/dropped values).

- [ ] **Step 3: Implement**

In `parseContraindication` (src/parser.ts:987-1045):

1. Severity branch — replace the silent `if (CONTRAINDICATION_SEVERITY_SET.has(sevStr))` with:

```ts
if (CONTRAINDICATION_SEVERITY_SET.has(sevStr)) {
  severity = sevStr as ContraindicationSeverity;
} else {
  addError(state, /* same ParseError shape as neighboring call sites */ {
    ...,
    message: `unknown contraindication severity '${sevStr}' — expected one of: low, moderate, high. Refusing to drop a safety field silently.`,
  });
}
```

2. Both action branches (keyword form and legacy arrow form) — replace the silent `if (CONTRAINDICATION_ACTION_SET.has(actionStr))` with the same pattern: known → assign; unknown → `addError` with message `unknown contraindication action '<x>' — expected one of: exclude, modify, require_clearance. A typo here must not downgrade enforcement.` Remove the implicit default-stays-`exclude` semantics for the error path (the compile fails anyway).
3. `affects` resolution: where `affectsList = parseEnumList(state)` is assigned (line 1037), map each entry through the same resolver the plan body uses: `affectsList = parseEnumList(state).map((ref) => resolveExerciseRef(state, ref));` — this gives affects entries identical substitution/repair/warning behavior as body refs (closes the H1 asymmetry where `affects deadlifts` could never match the body's `deadlift`).

- [ ] **Step 4: Run** — new tests PASS; full suite: any fixture relying on tolerant contraindication typos must be fixed to valid values.

- [ ] **Step 5: Commit**

```bash
git add src/parser.ts __tests__/contraindication-strict.test.ts
git commit -m "feat!: contraindication severity/action typos are hard errors; affects lists resolved like body refs"
```

### Task 17: The end-to-end safety invariant test (compile → enforce → assert absence)

**Files:**
- Create: `/Users/alex/Projects/my/gymbile.com/wpl-ai/__tests__/safety-invariant.test.ts`

This is the test the audit said doesn't exist anywhere: the package's core safety claim, asserted directly.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { compileWplAi } from "../src/index.js";
import { enforce } from "@gymbile/wpl-validator";
import { MINIMAL_PLAN } from "./helpers/minimal-plan.js";

function allActivityNames(plan: Record<string, unknown>): string[] {
  const names: string[] = [];
  const p = (plan as any).plan;
  for (const phase of p?.phases ?? [])
    for (const week of phase.weeks ?? [])
      for (const day of week.days ?? [])
        for (const block of day.blocks ?? [])
          for (const act of block.activities ?? []) {
            const n = act.exercise_ref ?? act.name;
            if (typeof n === "string") names.push(n);
          }
  return names;
}

describe("SAFETY INVARIANT: a contraindicated exercise must not survive compile+enforce", () => {
  it("holds for a plan that prescribes the contraindicated movement", () => {
    // MINIMAL_PLAN must contain at least one known exercise; forbid it.
    const compiled = compileWplAi(MINIMAL_PLAN);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const target = allActivityNames(compiled.json)[0]!; // forbid the first prescribed exercise
    const result = enforce(compiled.json, { injuries: ["test_injury"] }, [{
      id: "forbid_target",
      condition: { field: "injuries", op: "contains", value: "test_injury" },
      actions: [{ type: "forbid_exercise", exercise: target }],
    }]);

    expect(result.stripped.length).toBeGreaterThan(0);
    expect(allActivityNames(result.plan)).not.toContain(target);
  });

  it("holds under name-variant emission (plural / spaced / capitalized)", () => {
    // Mutate the DSL's exercise spelling the way LLMs do and assert the
    // forbid still lands via fuzzy matching after compile.
    const compiled = compileWplAi(MINIMAL_PLAN);
    if (!compiled.ok) return;
    const target = allActivityNames(compiled.json)[0]!;
    const variants = [target + "s", target.replace(/_/g, " "), target.toUpperCase()];
    for (const v of variants) {
      const result = enforce(compiled.json, { injuries: ["x"] }, [{
        id: "r",
        condition: { field: "injuries", op: "contains", value: "x" },
        actions: [{ type: "forbid_exercise", exercise: v }],
      }]);
      expect(allActivityNames(result.plan), `variant '${v}' failed to strip`).not.toContain(target);
    }
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run __tests__/safety-invariant.test.ts` → PASS (if the UPPERCASE variant fails, that's a real matcher finding: fix `collides`' normalize in the **validator** repo to handle it — it lowercases, so it should pass — and add the case to the validator's matcher tests).

- [ ] **Step 3: Commit**

```bash
git add __tests__/safety-invariant.test.ts
git commit -m "test: end-to-end safety invariant — contraindicated exercise cannot survive compile+enforce"
```

### Task 18: README corrections + version 2.0.0

**Files:**
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-ai/README.md`
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-ai/CHANGELOG.md`
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-ai/package.json`

- [ ] **Step 1: Fix the two documented falsehoods**

1. README.md:41 "Requires Node ≥18" → "Requires Node ≥20" (package.json engines already says ≥20).
2. README.md:212 — the `bestMatch("dummbell_curl")` example claims it returns `'dumbbell_curl'`, which is not in the catalog (it actually returns `dumbbell_row` — audit C2). Verify with `node -e "const {bestMatch}=require('./dist/index.cjs'); console.log(bestMatch('dummbell_curl'))"` after `npm run build`, then rewrite the example with a real input/output pair from the actual catalog (e.g. `bestMatch('bnech_press') → 'bench_press'` — verify it too).

- [ ] **Step 2: Document the new posture in README**

Add a "Safety posture (2.0)" section: repairs ledger (with a 6-line example reading `r.repairs`), fail-closed safety sections, strict contraindications, unknown-exercise warnings, link to `@gymbile/wpl-validator`'s `enforce()`.

- [ ] **Step 3: CHANGELOG 2.0.0**

```markdown
## [2.0.0] — <today>

### BREAKING
- Unknown ALL-CAPS sections matching `REQUIRE*/CONTRA*/SAFETY*/PRECAUTION*/MEDICAL*/CLEARANCE*`
  are hard parse errors (previously skipped silently — a typo'd `REQUIREMENTS:` erased
  all contraindications with no trace).
- Unknown contraindication `severity`/`action` values are hard parse errors
  (previously: severity dropped, action downgraded to `exclude`).

### Added
- `repairs[]` on successful compiles: every tolerant normalization is recorded —
  skipped sections/blocks, fuzzy exercise substitutions (from/to), uncataloged refs
  kept verbatim, lenient-default fabrications, discarded modifiers.
- Semantic warning for exercise refs absent from the catalog (the warning the
  1.12 comments claimed existed but didn't).
- Contraindication `affects` lists resolved through the same machinery as body
  exercise refs (typo correction + repairs + warnings).
- End-to-end safety-invariant test with `@gymbile/wpl-validator`'s `enforce()`.

### Fixed
- README: Node version requirement (≥20), `bestMatch` example used a non-catalog
  output.
```

Set `package.json` version `2.0.0` and `@gymbile/wpl-validator` dependency to `^1.8.0` (the file: install stays until Phase 5).

- [ ] **Step 4: Full check** — `npm test && npm run build` → green.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md package.json
git commit -m "chore(release): 2.0.0 — fail-closed safety paths, repairs ledger"
```

---

## Phase 4 — `wpl-eval`: consume the shipped enforcement + fix credibility gaps

Branch: `cd /Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval && git checkout -b v0.7-production-readiness`

Wire local packages first:

```bash
npm install /Users/alex/Projects/my/gymbile.com/wpl-validator-ts /Users/alex/Projects/my/gymbile.com/wpl-ai
npm test   # green baseline: 125 tests
```

**Important context for the worker:** committed `results/*.json` are frozen v0.6 artifacts. Do NOT regenerate or rescore them in this plan — code changes here affect *future* runs (v0.7 corpus). Nothing in this phase may mutate `results/` or the archive dirs.

### Task 19: Replace the local rule evaluator + stripper with `enforce()`

**Files:**
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/src/lanes/lane-b.ts`
- Delete: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/src/lib/rule-evaluator.ts`
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/test/rule-evaluator.test.ts` (retarget imports)
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/test/cycle-stripping.test.ts` (retarget to the real function)

- [ ] **Step 1: Retarget the rule-evaluator tests to the shipped package (failing first)**

In `test/rule-evaluator.test.ts`, change the import from `../src/lib/rule-evaluator.js` to `@gymbile/wpl-validator` and adapt call sites: `evaluate(personalization, ctx)` → `evaluateRules(personalization.rules, ctx).evaluated`. Run `npx vitest run test/rule-evaluator.test.ts` — fix signature fallout until green. These tests now pin the *shipped* evaluator's behavior (the point of the whole phase).

- [ ] **Step 2: Rewire lane-b.ts**

In `src/lanes/lane-b.ts`:
1. Replace `import { evaluate, firingActions } from "../lib/rule-evaluator.js"` with `import { enforce } from "@gymbile/wpl-validator";` (keep local `computeCycleDay` import only if still used by flare-window code).
2. In `runOnce` (lines 356-431), replace the entire static-forbids + perDayForbids + `stripForbidden` block with:

```ts
const ctx = buildClientContext(scenario);
const personalization = buildPersonalization(scenario, ctx);

const planStartDate =
  typeof (scenario.presenting as Record<string, unknown>)["plan_start_date"] === "string"
    ? ((scenario.presenting as Record<string, unknown>)["plan_start_date"] as string)
    : undefined;

// Flare windows stay eval-side: they're a scenario-authoring concept, passed
// to the shipped engine as per-day extra forbids.
const flareForbids: ReadonlySet<string> =
  ctx.cycle?.flare_windows?.length && scenario.blacklist.exercises_on_flow_days?.length
    ? new Set(scenario.blacklist.exercises_on_flow_days)
    : new Set();
const perDayExtraForbids =
  flareForbids.size > 0
    ? (date: string): ReadonlySet<string> => {
        for (const w of ctx.cycle!.flare_windows!) {
          if (date >= w.start && date <= w.end) return flareForbids;
        }
        return new Set();
      }
    : undefined;

const enforced = enforce(compiled.json, ctx, personalization.rules ?? [], {
  planStartDate,
  perDayExtraForbids,
});
if (enforced.diagnostics.length > 0) {
  // An unenforceable rule in the eval is an authoring bug — fail loudly,
  // never score a lane whose safety rules silently didn't apply.
  throw new Error(
    `enforce() diagnostics for ${scenario.id}: ${JSON.stringify(enforced.diagnostics)}`,
  );
}
const planJson = enforced.plan;
```

3. Delete the now-unused local functions `isForbidden` and `stripForbidden` (lines 454-536) and the static/perDay scaffolding they served.
4. Delete `src/lib/rule-evaluator.ts`.

- [ ] **Step 3: Retarget cycle-stripping tests to the real composition**

`test/cycle-stripping.test.ts` currently re-implements the strip composition instead of testing it (audit W6). Rewrite its cases to call the real `enforce()` from `@gymbile/wpl-validator` with the same inputs lane-b now passes, asserting the same expectations the old test encoded. Keep the scenario-shaped inputs; drop the local re-implementation entirely.

- [ ] **Step 4: Run** — `npm test` → all green; `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add -A src/ test/ package.json package-lock.json
git commit -m "refactor!: Lane B uses @gymbile/wpl-validator enforce() — eval no longer ships its own enforcement"
```

### Task 20: Integration tests on the real Lane B pipeline (the retraction-class gap)

**Files:**
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/src/lanes/lane-b.ts` (export `extractFromWplJson`)
- Create: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/test/lane-b-integration.test.ts`

- [ ] **Step 1: Export the walker**

In lane-b.ts change `function extractFromWplJson` to `export function extractFromWplJson`.

- [ ] **Step 2: Write the integration tests**

The "0/180" retraction happened because the walker silently read the wrong path and saw an empty plan. These tests make that class of bug impossible to ship silently again:

```ts
import { describe, it, expect } from "vitest";
import { compileWplAi } from "@gymbile/wpl-ai";
import { extractFromWplJson } from "../src/lanes/lane-b.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// INVARIANT: if the compiler succeeded on DSL containing exercises, the
// Lane B walker MUST see them. A successful compile + empty extraction is
// exactly the measurement bug that caused the v0.6 retraction.
describe("compile → extract invariant", () => {
  // Use the wpl-ai conformance corpus as ground truth DSL inputs.
  const FIXTURE_DIR = "/Users/alex/Projects/my/gymbile.com/wpl/conformance/compile/fixtures";
  // Pick every category dir; each fixture has a DSL source + expected JSON —
  // read the corpus layout first and adapt the globbing.
  const dslFiles = readdirSync(FIXTURE_DIR, { recursive: true })
    .map(String)
    .filter((f) => /\.(wpl|dsl|txt)$/.test(f))
    .slice(0, 40); // breadth without slowing the suite

  it("found fixtures to test against", () => {
    expect(dslFiles.length).toBeGreaterThan(10);
  });

  for (const f of dslFiles) {
    it(`walker sees what the compiler emitted: ${f}`, () => {
      const src = readFileSync(join(FIXTURE_DIR, f), "utf8");
      const r = compileWplAi(src);
      if (!r.ok) return; // parser-error fixtures are out of scope here
      const extracted = extractFromWplJson(r.json);
      const jsonStr = JSON.stringify(r.json);
      const hasExerciseActivities = /"exercise_ref"/.test(jsonStr);
      if (hasExerciseActivities) {
        expect(extracted.exercises.length, `compile ok but walker extracted 0 exercises from ${f}`).toBeGreaterThan(0);
      }
    });
  }
});
```

Worker note: check the actual fixture extension/layout in the conformance corpus (`ls` it first). If fixtures live as JSON pairs with embedded DSL, adapt the read. The invariant assertion is the deliverable; the corpus-walking details are flexible.

- [ ] **Step 3: Run** — `npx vitest run test/lane-b-integration.test.ts` → PASS. If any fixture trips the invariant, that is a live walker bug: STOP and report to the user before proceeding (do not "fix" the test).

- [ ] **Step 4: Commit**

```bash
git add src/lanes/lane-b.ts test/lane-b-integration.test.ts
git commit -m "test: compile→extract invariant — a successful compile can never silently extract an empty plan"
```

### Task 21: Fixed third-party extractor for Lane A (kills the self-extraction confound)

**Files:**
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/src/lanes/lane-a.ts` (lines ~38 and ~135 — the `extractPlan(model, ...)` call sites)
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/src/lib/extraction.ts`
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/src/runner.ts` (config plumb-through)

- [ ] **Step 1: Add the fixed-extractor config**

In `src/lib/extraction.ts`, add at the top:

```ts
// v0.7: Lane A extraction uses ONE fixed model for every trial, regardless of
// which model generated the plan. v0.5/v0.6 used the model-under-test as its
// own extractor, which confounds cross-model safety comparisons (a more
// capable model extracts its own output more exhaustively and so *looks*
// less safe). gpt-4.1 is the designated extractor: non-reasoning,
// deterministic at temperature 0, cheap, and not a flagship under test.
export const EXTRACTOR_MODEL_NAME = process.env["WPL_EVAL_EXTRACTOR_MODEL"] ?? "gpt-4.1";
```

- [ ] **Step 2: Rewire the call sites**

Read how `extractPlan(model, text)` receives its model and how models are constructed in the runner (`grep -n "extractPlan\|makeModel\|getModel" src/lanes/lane-a.ts src/runner.ts src/lib/extraction.ts`). Change `extractPlan` to construct/receive the fixed extractor model internally (one instance, module-level lazy init) instead of taking the model-under-test. Both lane-a call sites become `extractPlan(result.text)`. Record the extractor identity in the per-trial result JSON: add `extractor_model: EXTRACTOR_MODEL_NAME` next to where `extractor_raw` is persisted, so future audits can verify which extractor produced each artifact.

- [ ] **Step 3: Unit-test the wiring**

Add to an existing test file or create `test/extraction-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EXTRACTOR_MODEL_NAME } from "../src/lib/extraction.js";

describe("fixed extractor", () => {
  it("defaults to gpt-4.1 and is env-overridable", () => {
    expect(EXTRACTOR_MODEL_NAME).toBe(process.env["WPL_EVAL_EXTRACTOR_MODEL"] ?? "gpt-4.1");
  });
});
```

(The full behavioral verification is an API-spending smoke run — Phase 5.)

- [ ] **Step 4: Run** — `npm test` green; `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/ test/
git commit -m "feat!: Lane A extraction uses one fixed extractor model (gpt-4.1) for all trials"
```

### Task 22: Unify multi-turn semantics — latest-valid-turn in the live runner

**Files:**
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/src/lanes/lane-b.ts` (multi-turn runner, around lines 616-646)
- Reference: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/src/scripts/rescore-multiturn-lateststate.ts` (the published semantics)

The published v0.6 multi-turn numbers come from the rescore script's latest-valid-turn semantics, but a fresh `npm run eval` still uses last-executed-turn semantics and never writes `latest_valid_turn` (audit W7). Make the live runner produce the published semantics natively.

- [ ] **Step 1: Read both implementations**

Read `src/scripts/rescore-multiturn-lateststate.ts` fully — note exactly how it (a) selects the latest turn whose compile succeeded, (b) computes the final violations from that turn, (c) writes `latest_valid_turn`. Then read the multi-turn section of lane-b.ts.

- [ ] **Step 2: Write the failing test**

Create `test/multiturn-semantics.test.ts`. Extract the turn-selection logic into a pure exported function first (next step) so it's testable without API calls:

```ts
import { describe, it, expect } from "vitest";
import { selectLatestValidTurn } from "../src/lanes/lane-b.js";

type TurnLike = { wpl_valid: boolean; violations: unknown[] };

describe("latest-valid-turn selection", () => {
  it("picks the last turn that compiled", () => {
    const turns: TurnLike[] = [
      { wpl_valid: true, violations: ["a"] },
      { wpl_valid: false, violations: [] },
      { wpl_valid: true, violations: [] },
      { wpl_valid: false, violations: [] },
    ];
    expect(selectLatestValidTurn(turns)).toBe(2);
  });
  it("returns null when no turn compiled", () => {
    expect(selectLatestValidTurn([{ wpl_valid: false, violations: [] }])).toBe(null);
  });
});
```

- [ ] **Step 3: Implement**

In lane-b.ts export the pure selector (mirroring the rescore script's rule exactly — same tie-breaks):

```ts
// Latest-valid-turn semantics (v0.6 published methodology): the plan the
// client would actually hold at conversation end is the most recent turn
// whose DSL compiled. Later non-compiling turns leave the previous valid
// plan in force. Returns the turn index, or null if no turn ever compiled.
export function selectLatestValidTurn(turns: Array<{ wpl_valid: boolean }>): number | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]!.wpl_valid) return i;
  }
  return null;
}
```

Then in the multi-turn result assembly, compute final-state fields from `selectLatestValidTurn(turns)` instead of the last executed turn, and write `latest_valid_turn` into the result JSON exactly as the rescore script does (same field name/shape — diff the script's output writing code and replicate).

- [ ] **Step 4: Run** — `npm test` green.

- [ ] **Step 5: Deprecate the divergence**

Add a header comment to `src/scripts/rescore-multiturn-lateststate.ts`: `// v0.7+: the live runner implements these semantics natively (lane-b.ts selectLatestValidTurn). This script remains only to re-derive the frozen v0.6 corpus.`

- [ ] **Step 6: Commit**

```bash
git add src/ test/
git commit -m "fix: live multi-turn runner uses latest-valid-turn semantics (matches published v0.6 methodology)"
```

### Task 23: Repeats + confidence intervals in the headline tables

**Files:**
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/src/runner.ts` (`--repeats` flag)
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/src/scripts/headline-all.mjs` (Wilson CIs)
- Create: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/src/lib/stats.ts`
- Test: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/test/stats.test.ts`

- [ ] **Step 1: Write the failing stats test**

```ts
import { describe, it, expect } from "vitest";
import { wilsonInterval } from "../src/lib/stats.js";

describe("wilsonInterval", () => {
  it("matches known values (19/60, 95%)", () => {
    const { lo, hi } = wilsonInterval(19, 60);
    expect(lo).toBeCloseTo(0.211, 2);
    expect(hi).toBeCloseTo(0.443, 2);
  });
  it("degenerate cases", () => {
    expect(wilsonInterval(0, 0)).toEqual({ lo: 0, hi: 1 });
    const all = wilsonInterval(10, 10);
    expect(all.hi).toBe(1);
    expect(all.lo).toBeGreaterThan(0.6);
  });
});
```

- [ ] **Step 2: Implement `src/lib/stats.ts`**

```ts
// Wilson score interval for a binomial proportion (95% by default).
// Used for headline unsafe-rate cells so published reductions carry
// uncertainty instead of implying N=1-cell precision.
export function wilsonInterval(
  successes: number,
  n: number,
  z = 1.959963984540054,
): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, center - margin), hi: Math.min(1, center + margin) };
}
```

Run `npx vitest run test/stats.test.ts` → PASS (if the known-value expectations are off by >0.01, recompute them by hand with the formula and fix the *test constants*, not the formula).

- [ ] **Step 3: `--repeats` in the runner**

Read how `src/runner.ts` parses flags and iterates (model, scenario, lane, phase) cells. Add `--repeats=N` (default 1). For N>1, run each cell N times, writing results as `<model>__<scenario>__<lane>__<phase>__r<k>.json` (k=1..N; k=1 keeps the legacy un-suffixed name so existing tooling still finds it). Persist `repeat_index` inside the JSON too.

- [ ] **Step 4: CIs in headline-all.mjs**

In `src/scripts/headline-all.mjs`, wherever an unsafe-rate cell `x/n` is printed, also print the Wilson 95% interval: `32% [21%, 44%]`. Import the function (the script is .mjs and stats.ts is TS — either port the 15-line function inline with a comment `// keep in sync with src/lib/stats.ts (tested there)` or convert the script to .ts; inline port is less disruptive). Aggregate repeats by treating each repeat-trial as an independent Bernoulli draw (denominator includes all repeats).

Also fix audit W9 while in the file: errored trials (`r.error`) must be excluded from `n`, not just from numerators — find the `n` counter and add the same skip the other counters use.

- [ ] **Step 5: Run on the frozen corpus**

`node src/scripts/headline-all.mjs` → tables render with CI columns; numbers (point estimates) must be IDENTICAL to the committed v0.6 tables except where the W9 denominator fix legitimately changes `n` — if any point estimate changes, report exactly which cells and why in the final summary (this is a disclosed correction, not a silent one).

- [ ] **Step 6: Commit**

```bash
git add src/ test/
git commit -m "feat: --repeats flag and Wilson 95% CIs in headline tables; exclude errored trials from denominators"
```

### Task 24: Decouple rule authoring from the grading key (de-circularize Lane B)

**Files:**
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/scenarios/scenarios.yaml`
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/src/lanes/lane-b.ts` (`buildPersonalization`)
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/src/lib/types.ts` (Scenario type)
- Test: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/test/scenario-rules.test.ts`

Today `buildPersonalization()` derives Lane B's forbid rules directly from `scenario.blacklist` — the grading key (audit W1). The fix: scenarios carry an explicit `rules:` block, authored as a *product* artifact (what a trainer/clinician would configure), separate from `blacklist:` (what the grader checks). The code stops reading `blacklist` for rule construction entirely.

- [ ] **Step 1: Extend the Scenario type**

In `src/lib/types.ts`, add to the `Scenario` interface (read it first for style):

```ts
/**
 * Product-side personalization rules for Lane B — the rules a trainer would
 * actually configure for this client. Authored SEPARATELY from `blacklist`
 * (the grading key): the eval measures how well product rules approximate
 * the clinical blacklist, instead of wiring the answer key into the filter.
 * Schema matches @gymbile/wpl-validator's Rule type.
 */
rules?: Array<{
  id: string;
  condition?: unknown;
  actions: Array<{ type: string; [k: string]: unknown }>;
}>;
```

- [ ] **Step 2: Replace `buildPersonalization`**

In lane-b.ts:

```ts
// v0.7: rules come from the scenario's authored `rules:` block, not from the
// grading blacklist. A scenario without rules runs Lane B with governance
// configured to nothing — a legitimate measurement of an unconfigured rollout.
function buildPersonalization(scenario: Scenario): { rules: Rule[] } {
  return { rules: (scenario.rules ?? []) as Rule[] };
}
```

(Adjust the one caller: it no longer takes `ctx`.) Import `Rule` from `@gymbile/wpl-validator`. Delete the blacklist-derived rule construction (lines 144-187). The flare-window per-day-extra logic from Task 19 stays — but change its source from `scenario.blacklist.exercises_on_flow_days` to the scenario's flow-conditioned rules: collect `exercise` payloads from rules whose condition references `cycle_day` (grep the rule list), so flare windows amplify *authored* rules, not the grading key.

- [ ] **Step 3: Author the `rules:` blocks for all 20 scenarios**

In `scenarios.yaml`, add a `rules:` block to each scenario. **Authoring discipline (this is the de-circularization):** write each rule from the scenario's `presenting` clinical context and its cited sources — i.e., "what would a competent trainer configure for this client" — NOT by copying the blacklist. Where the authored rule legitimately overlaps the blacklist (it usually will — both derive from the same clinical reality), that's fine; the point is the rule text is derived from the condition, not from the answer key, and imperfect coverage is now *measurable*. Format per scenario:

```yaml
rules:
  - id: forbid_knee_dominant_loading
    condition: { field: injuries, op: contains, value: torn_meniscus }
    actions:
      - { type: forbid_exercise, exercise: pistol_squat }
      - { type: forbid_exercise, exercise: deep_squat }
  - id: flow_window_intensity
    condition: { field: cycle_day, op: in, value: [1, 2, 3] }
    actions:
      - { type: forbid_exercise, exercise: high_impact_plyometrics }
```

(Multiple actions per rule are supported — `evaluateRules` returns all.) Work scenario-by-scenario; read each scenario's `presenting`, `blacklist` citations and write 2-6 rules. Flag in the final report: **these authored rules need clinician sign-off (v0.7 human-in-the-loop step) — mark each with `# AUTHOR: gymbile-eng, PENDING clinician review` comments.**

- [ ] **Step 4: Test the loading**

`test/scenario-rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadScenarios } from "../src/lib/scenarios.js"; // find the real loader name via grep

describe("scenario rules blocks", () => {
  const scenarios = loadScenarios();
  it("every non-control scenario has authored rules", () => {
    for (const s of scenarios) {
      if (s.id === "ocp_suppressed") continue; // negative control: no forbids by design
      expect(s.rules?.length ?? 0, `${s.id} has no rules block`).toBeGreaterThan(0);
    }
  });
  it("every rule passes the shipped evaluator without diagnostics", async () => {
    const { evaluateRules } = await import("@gymbile/wpl-validator");
    for (const s of scenarios) {
      const { diagnostics } = evaluateRules((s.rules ?? []) as never, { injuries: ["x"] });
      expect(diagnostics, `${s.id}: ${JSON.stringify(diagnostics)}`).toHaveLength(0);
    }
  });
});
```

Adapt the loader import to the real module (`grep -rn "scenarios.yaml" src/`).

- [ ] **Step 5: Run** — `npm test` green. Note: existing tests that asserted blacklist-derived rule behavior (parts of `cycle.test.ts` / retargeted `cycle-stripping.test.ts`) may need their rule inputs switched from blacklist-derivation to explicit rule literals — preserve the assertions, change the construction.

- [ ] **Step 6: Commit**

```bash
git add scenarios/ src/ test/
git commit -m "feat!: Lane B rules authored per-scenario in scenarios.yaml — grading blacklist no longer feeds the filter"
```

### Task 25: Methodology doc corrections (the one-file-read discrepancies)

**Files:**
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/docs/METHODOLOGY.md`
- Modify: `/Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval/README.md`

- [ ] **Step 1: Fix the temperature claim**

`src/models/openai.ts:35-49` never sets temperature for the GPT-5 family (the API rejects/ignores it for reasoning models), yet METHODOLOGY.md:154,195 claims "Temperature = 0 for reproducibility" for both lanes. Rewrite those passages to the truth:

```markdown
Sampling: `gpt-4.1`, `claude-sonnet-4-6`, `claude-haiku-4-5` run at `temperature: 0`.
The GPT-5 family (gpt-5, gpt-5-mini, gpt-5-nano) does not accept a temperature
parameter — sampling is model-controlled, as it is for `claude-opus-4-7`. Five of
seven models are therefore NOT deterministic across runs; single-run cells carry
sampling noise, which is why v0.7 headline tables report Wilson 95% intervals
(and `--repeats` exists for variance estimation).
```

Verify the model list against `src/models/openai.ts` and `src/models/anthropic.ts` before writing (which models actually get the param — read the code, state exactly that).

Also correct the `max_completion_tokens` discrepancy if present (audit W4: GPT-5 silently gets 2×/4× the documented 6000/8000 — read `src/models/openai.ts` and document the real values).

- [ ] **Step 2: Document the v0.7 design changes**

Add a "Changes in v0.7" section to METHODOLOGY.md: fixed third-party extractor (and why), authored-rules decoupling (and why — quote the circularity critique honestly), latest-valid-turn now native, CIs, repeats, enforcement now via published `@gymbile/wpl-validator@1.8`. Update README.md's lane-B pipeline diagram line to `... → @gymbile/wpl-validator validate() + enforce(clientContext) → blacklist scoring`.

- [ ] **Step 3: Commit**

```bash
git add docs/METHODOLOGY.md README.md
git commit -m "docs: correct temperature/determinism claims; document v0.7 methodology changes"
```

---

## Phase 5 — Integration, smoke run, release gates

### Task 26: Cross-repo integration check

- [ ] **Step 1: Full test sweep, all four repos**

```bash
cd /Users/alex/Projects/my/gymbile.com/wpl && npx ajv compile --spec=draft2020 -s schema/v1.schema.json
cd /Users/alex/Projects/my/gymbile.com/wpl-validator-ts && npm test && npm run typecheck && npm run build
cd /Users/alex/Projects/my/gymbile.com/wpl-ai && npm test && npm run build
cd /Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval && npm test && npx tsc --noEmit
```

Expected: everything green. Fix forward any breakage; do not weaken assertions.

- [ ] **Step 2: Zero-cost rescore sanity check**

```bash
cd /Users/alex/Projects/my/gymbile.com/wpl-eval/wpl-eval
npx tsx src/scripts/rescore-lane-b.ts --dry-run 2>/dev/null || npx tsx src/scripts/rescore-lane-b.ts
```

⚠️ This script recompiles stored raw_text with the NEW compiler (2.0.0) — fail-closed sections/contraindications may now fail compiles that passed under 1.13. **Run it writing to a scratch dir if it supports one; otherwise `git stash`-protect `results/` (`git status` must be clean over `results/` afterward — `git checkout -- results/` if not).** The purpose is informational: count how many frozen v0.6 Lane B trials would now fail-closed, and report the number to the user — it quantifies how much silent tolerance the old pipeline depended on. Do NOT commit any change under `results/`.

- [ ] **Step 3: Paid smoke run (REQUIRES USER APPROVAL — API spend)**

ASK THE USER before running. Cost: ~$2-4.

```bash
npm run eval -- --models=gpt-5-mini --scenarios=torn_meniscus,severe_dysmenorrhea --phases=single --out=results-v0.7-smoke
```

(Adapt flag names to the real runner CLI — `grep -n "argv\|flags" src/runner.ts`.) Verify in the output JSONs: `extractor_model: "gpt-4.1"` present on Lane A; Lane B has `stripped[]`-consistent behavior (violations only where authored rules don't cover the blacklist); no `enforce()` diagnostics thrown. Delete or keep the smoke dir per user preference.

- [ ] **Step 4: Commit any smoke-revealed fixes**, each as its own conventional commit.

### Task 27: Release sequence (EVERY push/publish REQUIRES EXPLICIT USER APPROVAL)

Present this checklist to the user and execute only the approved items, in order:

1. `wpl`: push branch + tags `v1.6.0`, `v1.7.0` → triggers the wpl.dev mirror workflow (fixes the unmirrored-1.6.0 hygiene break).
2. `wpl-validator-ts`: push branch, merge, `npm publish` 1.8.0 (prepublishOnly runs tests+build).
3. `wpl-ai`: switch the file: dependency back to `"@gymbile/wpl-validator": "^1.8.0"`, `npm install`, full test, commit `chore: registry dependency`, push, publish 2.0.0.
4. `wpl-eval`: switch file: deps to `"@gymbile/wpl-ai": "^2.0.0"` + `"@gymbile/wpl-validator": "^1.8.0"`, `npm install`, `npm test`, commit, push branch + open PR to `main`.
5. After all merges: update the eval README "Quick start" pin line (`npm install pins @gymbile/wpl-ai ^2.0.0, @gymbile/wpl-validator ^1.8.0`).

### Task 28: Final report to the user

Write (to chat, not a file) a summary containing:
- Per-repo: branch name, commit list (`git log --oneline main..HEAD`), version bumped.
- The Task-26 Step-2 number: how many frozen v0.6 Lane B trials would fail-closed under the 2.0 compiler.
- All deviations from this plan and why.
- The explicitly deferred work (see below) — confirm none of it silently leaked into scope.

---

## Explicitly OUT of scope for this plan (v0.7 later waves — do not implement)

1. **Structural enforcement actions** (rest-day floors, progression caps, intensity ceilings) — requires clinical threshold sign-off first; the enforcement engine's `APPLICABLE_ACTIONS` set is designed to grow.
2. **Canonical exercise registry + alias table as a published artifact** — entity-identity overhaul; strict catalog mode (Task 7) is the interim posture.
3. **Clinician validation of blacklists and the new authored rules** — human-in-the-loop step; rules are marked `PENDING clinician review`.
4. **Google Gemini models** — after the measurement fixes land.
5. **Re-running the full 560-trial corpus** — new numbers are a separate, budgeted decision.
6. **Prose spec regeneration** — STALE markers are the interim state.
7. **Elixir ports** (`wpl-validator-ex` enforcement parity, backend RuleEvaluator swap) — separate plan; the enforcement conformance fixtures (Task 11) are written to be the cross-language contract when that happens.

## Self-review notes (worker: read before starting)

- Type-consistency contract across tasks: `enforce(planJson, ctx, rules, options?) → EnforcementResult` (Task 10) is what Tasks 17, 19, 24 consume; `evaluateRules(rules, ctx) → { evaluated, diagnostics }` (Task 9) is what Tasks 19 (via enforce), 24's test consume; `selectLatestValidTurn(turns) → number | null` (Task 22); `wilsonInterval(successes, n, z?) → {lo, hi}` (Task 23); `Repair` (Task 13) is the wpl-ai-side ledger — distinct from the validator's `RepairHint` (pre-existing, unrelated).
- Steps marked "Worker note" contain the known reality-vs-plan risk points (fixture DSL shapes, ParseError field shape, conformance corpus layout, runner CLI flags, cycle-date arithmetic). At each: read the real code first, adapt the *letter* of the step, preserve its *contract*, note the deviation.
- The three hard tripwires: (1) never mutate `results/`; (2) never push/publish without explicit user approval; (3) if the Task-20 invariant test finds a live walker bug, stop and surface it — that's a v0.6-numbers problem, not a v0.7 task.
