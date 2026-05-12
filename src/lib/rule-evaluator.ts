// TypeScript port of GymbileBackend.WellnessPlans.Personalization.RuleEvaluator
// (gymbile_backend/lib/.../rule_evaluator.ex). Pure evaluator: takes a
// `personalization` map and a ClientContext, returns one entry per rule with
// `condition_met?`, normalised actions, and the original condition.
//
// Behavioural invariants ported from the Elixir version:
//   - `nil`/`undefined` field values short-circuit comparisons to `false`
//     (rules never match on missing data — safer than matching defaults).
//   - String/atom normalisation for eq/neq so an atom-like value compares
//     equal to its string form.
//   - `contains` / `not_contains` handle both list and string `actual` values.
//   - Action keys at the top level are normalised to strings.
//   - `condition` of `null` / `undefined` means "always fires" (returns true).
//   - Non-firing rules are still returned in the output (the UI surfaces
//     "rules considered" so trainers see what didn't apply and why).

import type { ClientContext } from "./types.js";

export interface RuleAction {
  type: string;
  [k: string]: unknown;
}

export interface EvaluatedRule {
  rule_id: string;
  condition_met: boolean;
  actions: RuleAction[];
  condition: Condition | null;
}

type CompoundCondition = {
  type: "compound";
  operator?: "and" | "or";
  conditions?: Condition[];
};

type SimpleCondition = {
  field: string;
  op?: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "not_contains";
  value?: unknown;
};

export type Condition = CompoundCondition | SimpleCondition;

interface RuleShape {
  id?: string;
  condition?: Condition | null;
  actions?: unknown;
}

interface PersonalizationShape {
  rules?: RuleShape[];
}

export function evaluate(
  personalization: PersonalizationShape | null | undefined,
  ctx: ClientContext,
): EvaluatedRule[] {
  if (!personalization || typeof personalization !== "object") return [];

  const rules = Array.isArray(personalization.rules) ? personalization.rules : [];

  return rules.map((rule, idx) => {
    const condition = rule.condition ?? null;
    const met = conditionMet(condition, ctx);
    const actionsRaw = Array.isArray(rule.actions) ? rule.actions : [];

    return {
      rule_id: rule.id ?? `rule_${idx + 1}`,
      condition_met: met,
      actions: actionsRaw.map(normalizeAction),
      condition,
    };
  });
}

export function firingActions(evaluated: EvaluatedRule[]): RuleAction[] {
  return evaluated.flatMap((r) => (r.condition_met ? r.actions : []));
}

// ---- condition_met? -------------------------------------------------------

function conditionMet(condition: Condition | null | undefined, ctx: ClientContext): boolean {
  if (condition === null || condition === undefined) return true;
  if (typeof condition !== "object") return false;

  if (isCompound(condition)) return compoundMatch(condition, ctx);
  if (isSimple(condition)) return simpleMatch(condition, ctx);
  return false;
}

function isCompound(c: Condition): c is CompoundCondition {
  return (c as CompoundCondition).type === "compound";
}

function isSimple(c: Condition): c is SimpleCondition {
  return typeof (c as SimpleCondition).field === "string";
}

function compoundMatch(c: CompoundCondition, ctx: ClientContext): boolean {
  const op = c.operator ?? "and";
  const conds = Array.isArray(c.conditions) ? c.conditions : [];

  if (op === "or") return conds.some((sub) => conditionMet(sub, ctx));
  return conds.every((sub) => conditionMet(sub, ctx));
}

function simpleMatch(c: SimpleCondition, ctx: ClientContext): boolean {
  const op = c.op ?? "eq";
  const actual = fieldValue(c.field, ctx);
  return compare(actual, op, c.value);
}

// ---- compare --------------------------------------------------------------

function compare(actual: unknown, op: string, value: unknown): boolean {
  // `nil` short-circuits to `false` — safer than letting `nil < n` raise
  // or evaluating to a confusing default.
  if (actual === null || actual === undefined) return false;

  switch (op) {
    case "eq":
      return stringify(actual) === stringify(value);
    case "neq":
      return stringify(actual) !== stringify(value);

    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (typeof actual !== "number" || typeof value !== "number") return false;
      if (op === "gt") return actual > value;
      if (op === "gte") return actual >= value;
      if (op === "lt") return actual < value;
      return actual <= value;
    }

    case "contains": {
      if (Array.isArray(actual)) {
        return actual.map(stringify).includes(stringify(value));
      }
      if (typeof actual === "string") {
        return actual.includes(stringify(value) ?? "");
      }
      return false;
    }

    case "not_contains": {
      if (Array.isArray(actual)) {
        return !actual.map(stringify).includes(stringify(value));
      }
      if (typeof actual === "string") {
        return !actual.includes(stringify(value) ?? "");
      }
      return false;
    }

    default:
      return false;
  }
}

// Normalise atoms/symbols to strings so eq/neq comparisons are stable
// regardless of whether the producer emitted `"high"` or `:high`.
function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return String(v);
}

// ---- field resolution -----------------------------------------------------

function fieldValue(field: string, ctx: ClientContext): unknown {
  switch (field) {
    case "weight":
    case "weight_kg":
      return ctx.weight_kg ?? null;
    case "height":
    case "height_cm":
      return ctx.height_cm ?? null;
    case "age":
      return ctx.age ?? null;
    case "sex":
    case "gender":
      return ctx.sex ?? null;
    case "experience":
    case "fitness_level":
      return ctx.experience ?? null;
    case "injuries":
    case "contraindications":
      return ctx.injuries ?? null;
    case "equipment":
      return ctx.equipment ?? null;
    case "fatigue":
      return ctx.fatigue ?? null;
    case "goals":
      return ctx.goals ?? null;
    default:
      return null;
  }
}

// ---- action normalisation -------------------------------------------------

function normalizeAction(a: unknown): RuleAction {
  if (a && typeof a === "object" && !Array.isArray(a)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(a)) out[String(k)] = v;
    if (typeof out["type"] !== "string") out["type"] = "noop";
    return out as RuleAction;
  }
  return { type: "noop", raw: String(a) };
}
