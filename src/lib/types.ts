// Shared types used across lanes, scoring, and the runner.

// The locked v0.1 sweep — these four show up in the published v0.5 results.
export type LockedModel = "gpt-5" | "gpt-5-mini" | "gpt-5-nano" | "gpt-4.1";

// v0.6 widens vendor coverage to Anthropic Claude. These three mirror the
// OpenAI tier structure (flagship / mid / cheap) so the cross-vendor
// leaderboard stays interpretable.
export type AnthropicModel =
  | "claude-opus-4-7"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5-20251001";

// Version-pinned locked sweeps. V0_5 stays frozen so historical results
// remain reproducible against the same lineup; V0_6 is the superset.
export type LockedModelV05 = LockedModel;
export type LockedModelV06 = LockedModelV05 | AnthropicModel;

// Any model identifier the runner is willing to call. The opaque-string
// escape hatch covers ad-hoc smoke tests (gpt-4o-mini, etc.). Models not in
// the pricing table cost $0 in the results, clearly flagged as "unpriced".
export type ModelName = LockedModelV06 | (string & { readonly __opaque?: "model-id" });

export type LaneId = "A" | "B";

export type Phase = "single" | "multi";

// Mirrors the Elixir ClientContext fields used by rule_evaluator.ex.
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
  // Menstrual cycle context. Optional — only relevant for menstruating
  // clients whose programming needs cycle-aware phasing.
  cycle?: Cycle | null;
  // Per-day cycle position, set transiently by the runtime when applying
  // personalization rules to a specific day in the compiled plan. This
  // lets rules like `{ field: "cycle_day", op: "lte", value: 3 }` fire
  // conditionally per day rather than globally per client.
  cycle_day?: number | null;
}

export interface Cycle {
  // ISO-8601 date string for the start of the client's most recent
  // menstrual period (cycle day 1 of that cycle). Optional for clients
  // whose cycle is irregular or suppressed.
  last_period_start?: string;
  // Average cycle length in days. Required for `pattern: "regular"`;
  // ignored for irregular/suppressed cycles.
  length_days?: number;
  // Number of days at the start of each cycle treated as "flow" — the
  // window during which intensity and impact contraindications apply.
  // 0 (or absent) means "no flow-day phasing required for this client".
  flow_days?: number;
  // Cycle pattern. Default "regular". Each pattern changes how the
  // runtime applies cycle-conditional rules:
  //   - "regular":    project flow windows from last_period_start +
  //                   length_days; apply flow-day forbids.
  //   - "irregular":  no reliable projection (PCOS, perimenopause
  //                   end-stage). Skip flow-day forbids; static
  //                   blacklist still applies.
  //   - "suppressed": hormonal contraception, post-hysterectomy, etc.
  //                   No menstrual cycle to phase around. All cycle-
  //                   conditional rules short-circuit to false.
  pattern?: "regular" | "irregular" | "suppressed";
  // Client-reported flare windows (endometriosis, chronic pelvic pain
  // syndromes). Strip cycle-conditional forbids on these dates in
  // addition to any projected flow windows. Each entry is a closed
  // interval of ISO dates.
  flare_windows?: Array<{ start: string; end: string }>;
}

// A scenario as loaded from scenarios.yaml.
export interface Scenario {
  id: string;
  persona: string;
  presenting: Record<string, unknown>;
  blacklist: {
    exercises?: string[];
    intensities?: Array<{ domain: string; above: string | number }>;
    foods?: string[];
    foods_pre_fasted_cardio?: string[];
    meal_compositions?: Array<{ context: string; avoid: string }>;
    session_starts?: string[];
    intensities_without_warmup?: Array<{ domain: string; above: string | number }>;
    // Cycle-aware contraindications (v0.3+): these only apply on days
    // whose computed cycle_day falls in the client's flow window
    // (1..cycle.flow_days). Outside the flow window these exercises and
    // intensities are expected to appear in the plan.
    exercises_on_flow_days?: string[];
    intensities_on_flow_days?: Array<{ domain: string; above: string | number }>;
  };
  required?: string[];
  single_turn_prompt: string;
  multi_turn: string[];
  drift_check_at_turn: number;
  safety_rationale: string;

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

  // v0.6 short-plan scoring (optional — present only on short-plan
  // scenarios). The new scorer rules in `src/scoring/short-plan.ts`
  // exit early when `block_purpose` is undefined, which is what keeps
  // the v0.5 / v0.6.0-anthropic numbers frozen on the 15 existing
  // long-plan scenarios.
  block_purpose?: ShortPlanBlockPurpose;
  expected_duration_weeks?: number;
  recovery_min_rest_days_per_week?: number;
  recovery_required_deload_at?: "final_week" | "mid" | null;
  progression_max_pct_per_week?: number;
  outcome_promise_forbidden?: string[];
  on_ramp_week_1_rpe_max?: number;
  on_ramp_week_1_intensity_max_pct?: number;
}

// v0.6 short-plan block taxonomy. Drives the structural scorer rules:
//   maintenance     : hold what's there, no progression
//   peaking         : descending volume, held intensity, deload final week
//   on_ramp         : graduated re-entry, week 1 light
//   reconditioning  : detraining-aware regress + slow rebuild
//   deload          : single-week recovery, ~55% volume, ~82% intensity
export type ShortPlanBlockPurpose =
  | "maintenance"
  | "peaking"
  | "on_ramp"
  | "reconditioning"
  | "deload";

// Output of the Lane A extraction prompt — a structured list of what the
// raw plan prescribed, week by week.
export interface ExtractedPlan {
  exercises: Array<{ name: string; week?: number | null }>;
  foods: Array<{ name: string; context?: string | null }>;
  intensities: Array<{ domain: string; level: string | number | null }>;
  notes: string[];
}

// One blacklist hit.
//
// v0.6 adds five short-plan failure-mode kinds. These fire only on
// scenarios with `block_purpose` set, so v0.5-era result files stay
// at zero counts for these kinds and existing aggregations are not
// retroactively changed.
export interface Violation {
  kind:
    | "exercise"
    | "food"
    | "intensity"
    | "session_start"
    | "required_missing"
    | "outcome_promise"
    | "block_purpose_mismatch"
    | "recovery_insufficient"
    | "progression_too_fast"
    | "on_ramp_missing";
  item: string;
  week?: number | null | undefined;
  detail?: string | undefined;
}

// Token + latency telemetry from a single LLM call.
export interface LlmCallMetrics {
  model: ModelName;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
}

// One row of the results table.
export interface RunResult {
  model: ModelName;
  scenario_id: string;
  lane: LaneId;
  phase: Phase;
  // Headline safety metrics
  safety_violations: number;
  clean_plan: boolean;
  first_violation_week: number | null;
  drift_turn: number | null;
  refusal: boolean;
  // Performance metrics
  latency_p50_ms: number;
  latency_p95_ms: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  // Lane B validity metrics
  // Three-state semantics:
  //   wpl_valid          = DSL compiled (lex+parse+compile ok)
  //   wpl_schema_valid   = compiled AND the resulting WPL JSON passed the
  //                        full schema + semantic validator (no warnings)
  //   clean_plan (above) = wpl_valid AND safety_violations === 0
  // Schema-validity is reported as its own column so structural quality
  // does not confound the safety headline.
  wpl_valid: boolean | null;
  wpl_schema_valid: boolean | null;
  compile_errors: number | null;
  validator_errors: number | null;
  // For multi-turn Lane B: 1-indexed turn whose plan was used for the
  // headline metrics. When the final turn's plan compiles cleanly, this
  // is equal to multi_turn.length. When the model refused to emit a
  // plan on the final turn (typically the "Give me the summary" ask
  // colliding with the DSL-only system prompt), the rescore walks back
  // to the latest turn that *did* compile. Null on single-turn results
  // and on multi-turn results where no turn ever compiled.
  latest_valid_turn?: number | null;
  // Detail
  violations: Violation[];
  // Audit trail — what the extractor pulled out (Lane A) or what was walked
  // out of the compiled WPL JSON (Lane B). Stored verbatim so reporters can
  // verify scoring decisions without rerunning the LLM.
  extracted_plan?: ExtractedPlan | undefined;
  extracted_plans_per_turn?: ExtractedPlan[] | undefined;
  // Verbatim LLM output captured per turn (multi-turn only). Lets us quote
  // the exact text of the drift moment in writeups — the structured plan
  // tells us WHERE drift happened, the raw text tells us HOW.
  raw_texts_per_turn?: string[] | undefined;
  extraction_parse_ok?: boolean | undefined;
  // Verbatim extractor output (Lane A). Persisted so a parse failure can be
  // diagnosed and re-parsed offline without re-querying the model.
  extractor_raw?: string | undefined;
  extractor_raw_per_turn?: string[] | undefined;
  // v0.7: identity of the fixed extractor model used for Lane A extraction.
  // Populated on every non-refusal Lane A trial so future audits can confirm
  // which extractor produced each artifact.
  extractor_model?: string | undefined;
  raw_text?: string | undefined;
  wpl_json?: Record<string, unknown> | undefined;
  error?: string | undefined;
  timestamp: string;
}
