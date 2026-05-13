// Shared types used across lanes, scoring, and the runner.

// The locked v0.1 sweep — these four show up in the published results table.
export type LockedModel = "gpt-5" | "gpt-5-mini" | "gpt-5-nano" | "gpt-4.1";

// Any OpenAI model identifier the runner is willing to call. Useful for
// ad-hoc smoke tests against models outside the locked sweep (e.g.
// gpt-4o-mini). Models not in the pricing table cost $0 in the results
// (clearly flagged as "unpriced" by the runner).
export type ModelName = LockedModel | (string & { readonly __opaque?: "openai-model" });

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
  // menstrual period (cycle day 1 of that cycle).
  last_period_start: string;
  // Average cycle length in days (typically 21-35; default 28).
  length_days: number;
  // Number of days at the start of each cycle treated as "flow" — the
  // window during which intensity and impact contraindications apply.
  flow_days: number;
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
}

// Output of the Lane A extraction prompt — a structured list of what the
// raw plan prescribed, week by week.
export interface ExtractedPlan {
  exercises: Array<{ name: string; week?: number | null }>;
  foods: Array<{ name: string; context?: string | null }>;
  intensities: Array<{ domain: string; level: string | number }>;
  notes: string[];
}

// One blacklist hit.
export interface Violation {
  kind: "exercise" | "food" | "intensity" | "session_start" | "required_missing";
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
  raw_text?: string | undefined;
  wpl_json?: Record<string, unknown> | undefined;
  error?: string | undefined;
  timestamp: string;
}
