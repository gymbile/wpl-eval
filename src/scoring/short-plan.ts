// v0.6 short-plan scorer.
//
// Five rule families that fire only on scenarios whose YAML declares a
// `block_purpose`. Existing v0.5 scenarios do not carry that field, so
// none of these rules fire on the v0.5 / v0.6.0-anthropic corpora —
// previously-published numbers are not retroactively changed.
//
// Architecture:
//   - outcome_promise_match runs on BOTH lanes (regex on text)
//   - block_purpose_match / recovery_scheduling / progression_rate_sanity
//     / on_ramp_present run on LANE B ONLY (need the compiled plan tree)
//
// The asymmetry is intentional and documents itself as evidence: Lane A
// hides structural failures inside prose; Lane B exposes them via the
// contract-required structured emission. See V0_6_SHORTPLANS_EXECUTION.md.

import type { Scenario, Violation } from "../lib/types.js";

// Default forbidden adaptation claims for plans under ~6 weeks. Scenarios
// can extend or replace this via `outcome_promise_forbidden` in the YAML.
// Patterns are matched case-insensitively as whole-word-ish substrings.
const DEFAULT_OUTCOME_PROMISES: string[] = [
  "build muscle",
  "gain muscle",
  "muscle growth",
  "hypertrophy",
  "improve vo2max",
  "vo2max gain",
  "improve body composition",
  "body recomposition",
  "lose .* (kg|lb|pounds)",
  "gain .* (kg|lb|pounds)",
  "personal record",
  "pr your",
  "set a pr",
  "build strength rapidly",
];

// What counts as a "rest day" in a compiled plan: a day object that has no
// activity-bearing main block. A day with only warmup/cooldown counts as
// a rest day (mobility, not training).
//
// 2026-06-08 schema: a day has `blocks[]`, each block has `type` and
// `activities[]`.
function dayHasTraining(day: Record<string, unknown>): boolean {
  const blocks = day["blocks"];
  if (!Array.isArray(blocks)) return false;
  for (const block of blocks as Record<string, unknown>[]) {
    if (block["type"] !== "main") continue;
    const acts = block["activities"];
    if (Array.isArray(acts) && acts.length > 0) return true;
  }
  return false;
}

interface WeekAggregate {
  weekIndex: number; // 1-based across the whole plan
  trainingDays: number;
  // Calendar days the week spans. When the LLM emits explicit `day_of_week`
  // entries (most plans do), we treat unlisted days as implicit rest and
  // set this to 7. Without `day_of_week`, we fall back to days.length.
  calendarDays: number;
  totalSets: number; // main-block prescription sets summed across the week
  avgRpe: number | null; // averaged across main-block target_rpe only
  maxRpe: number | null;
  hasNovelty: boolean; // not yet populated; reserved
}

// Walk plan.phases[].weeks[].days[].blocks[].activities[] and aggregate
// volume + intensity per week. Returns one entry per week in cursor
// order; phases are flattened. Accepts both the wrapped (`{plan: {...}}`)
// and unwrapped shapes — see extractFromWplJson() for the rationale.
function aggregateWeeks(json: Record<string, unknown>): WeekAggregate[] {
  const plan =
    typeof json["plan"] === "object" && json["plan"] !== null
      ? (json["plan"] as Record<string, unknown>)
      : json;
  const out: WeekAggregate[] = [];
  const phases = Array.isArray(plan["phases"]) ? (plan["phases"] as Record<string, unknown>[]) : [];
  let cursor = 0;
  for (const phase of phases) {
    const weeks = Array.isArray(phase["weeks"]) ? (phase["weeks"] as Record<string, unknown>[]) : [];
    for (const week of weeks) {
      cursor++;
      const days = Array.isArray(week["days"]) ? (week["days"] as Record<string, unknown>[]) : [];
      let trainingDays = 0;
      let totalSets = 0;
      let hasExplicitDayOfWeek = false;
      const rpes: number[] = [];
      for (const day of days) {
        if (dayHasTraining(day)) trainingDays++;
        if (typeof day["day_of_week"] === "number") hasExplicitDayOfWeek = true;
        const blocks = Array.isArray(day["blocks"]) ? (day["blocks"] as Record<string, unknown>[]) : [];
        for (const block of blocks) {
          // We only count *main* block sets and RPE for the trajectory
          // analysis. Warmup RPE (3-4) and cooldown RPE (1-2) would
          // otherwise drag down the avgRpe and mask intensity changes
          // in the main work.
          if (block["type"] !== "main") continue;
          const activities = Array.isArray(block["activities"])
            ? (block["activities"] as Record<string, unknown>[])
            : [];
          for (const activity of activities) {
            const presc = activity["prescription"];
            const sets =
              presc && typeof presc === "object"
                ? (presc as Record<string, unknown>)["sets"]
                : undefined;
            if (typeof sets === "number" && Number.isFinite(sets)) totalSets += sets;
            const rpeCandidates: Array<unknown> = [activity["target_rpe"]];
            if (presc && typeof presc === "object") {
              rpeCandidates.push((presc as Record<string, unknown>)["target_rpe"]);
              rpeCandidates.push((presc as Record<string, unknown>)["rpe"]);
            }
            for (const r of rpeCandidates) {
              if (typeof r === "number" && Number.isFinite(r)) {
                rpes.push(r);
                break;
              }
            }
          }
        }
      }
      // If the LLM emitted day_of_week fields, treat the week as 7
      // calendar days with the days array enumerating training days
      // explicitly. Otherwise (rare — some compilers emit the full week
      // with rest days as empty entries), fall back to days.length.
      const calendarDays = hasExplicitDayOfWeek ? 7 : days.length;
      out.push({
        weekIndex: cursor,
        trainingDays,
        calendarDays,
        totalSets,
        avgRpe: rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null,
        maxRpe: rpes.length ? Math.max(...rpes) : null,
        hasNovelty: false,
      });
    }
  }
  return out;
}

// Scan plan-level free-text fields for outcome-promise hits.
// Accepts either the wrapped (`{plan: {...}}`) or unwrapped shape.
function collectPlanText(json: Record<string, unknown> | null | undefined): string {
  if (!json) return "";
  const plan =
    typeof json["plan"] === "object" && json["plan"] !== null
      ? (json["plan"] as Record<string, unknown>)
      : json;
  const parts: string[] = [];
  for (const k of ["name", "description", "summary", "objective", "notes"]) {
    const v = plan[k];
    if (typeof v === "string") parts.push(v);
    if (Array.isArray(v)) for (const e of v) if (typeof e === "string") parts.push(e);
  }
  // Goal names + phase/week/day notes — short plans often hide outcome
  // claims here.
  const goals = Array.isArray(plan["goals"]) ? (plan["goals"] as Record<string, unknown>[]) : [];
  for (const goal of goals) {
    for (const k of ["name", "description"]) {
      const v = goal[k];
      if (typeof v === "string") parts.push(v);
    }
  }
  const phases = Array.isArray(plan["phases"]) ? (plan["phases"] as Record<string, unknown>[]) : [];
  for (const phase of phases) {
    for (const k of ["name", "description", "notes"]) {
      const v = phase[k];
      if (typeof v === "string") parts.push(v);
    }
    const weeks = Array.isArray(phase["weeks"]) ? (phase["weeks"] as Record<string, unknown>[]) : [];
    for (const week of weeks) {
      const wnotes = week["notes"];
      if (typeof wnotes === "string") parts.push(wnotes);
      if (Array.isArray(wnotes)) for (const e of wnotes) if (typeof e === "string") parts.push(e);
      const days = Array.isArray(week["days"]) ? (week["days"] as Record<string, unknown>[]) : [];
      for (const day of days) {
        for (const k of ["notes", "name"]) {
          const v = day[k];
          if (typeof v === "string") parts.push(v);
          if (Array.isArray(v)) for (const e of v) if (typeof e === "string") parts.push(e);
        }
      }
    }
  }
  return parts.join("\n");
}

function findOutcomePromises(text: string, patterns: string[]): string[] {
  if (!text) return [];
  const hits: string[] = [];
  for (const p of patterns) {
    try {
      const re = new RegExp(`\\b${p}\\b`, "i");
      const m = text.match(re);
      if (m) hits.push(p);
    } catch {
      // Bad regex in scenario YAML — silently skip rather than blow up
      // the whole scoring stage.
    }
  }
  return hits;
}

// Outcome-promise rule. Both lanes. Returns one violation per distinct
// forbidden phrase that appears in the plan's text channel.
//
// `text` is whatever free-form content was emitted by the model. Lane A
// passes the entire raw plan; Lane B passes the concatenation of every
// text-bearing field in the compiled JSON.
function scoreOutcomePromise(scenario: Scenario, text: string): Violation[] {
  if (!scenario.block_purpose) return [];
  const dur = scenario.expected_duration_weeks ?? 12;
  // Short-plan threshold: 5 weeks or fewer. v0.5's 12-week scenarios are
  // not penalised even though the regex would match — the rule is gated
  // on duration to keep the long-plan numbers untouched.
  if (dur > 5) return [];
  const patterns =
    scenario.outcome_promise_forbidden && scenario.outcome_promise_forbidden.length > 0
      ? scenario.outcome_promise_forbidden
      : DEFAULT_OUTCOME_PROMISES;
  const hits = findOutcomePromises(text, patterns);
  return hits.map((p) => ({
    kind: "outcome_promise" as const,
    item: p,
    detail: `Plan promises "${p}" but duration is ${dur}wk — that adaptation is not physiologically deliverable in this window.`,
  }));
}

// Helper: compare volume trajectory across weeks.
//   maintenance: flat — no week-over-week increase > 5%
//   peaking:    descending — final week ≤ 70% of week 1
//   on_ramp:    ascending — final week > week 1 (graduated)
//   reconditioning: ascending with regression in week 1 (caught by on_ramp_present)
//   deload:     flat / low — single week (no trajectory)
function scoreBlockPurpose(scenario: Scenario, weeks: WeekAggregate[]): Violation[] {
  if (!scenario.block_purpose) return [];
  if (weeks.length === 0) return [];
  const out: Violation[] = [];
  const bp = scenario.block_purpose;

  if (bp === "deload") {
    // Single-week deload: total weeks should be 1. Multi-week is fine
    // structurally (some PT software prepends a stub week) but flag
    // anything that prescribes more than 1 active week.
    const active = weeks.filter((w) => w.trainingDays > 0).length;
    if (active > 1) {
      out.push({
        kind: "block_purpose_mismatch",
        item: "deload_multi_week",
        detail: `Deload block should be a single week, plan emitted ${active} active weeks.`,
      });
    }
    return out;
  }

  if (bp === "maintenance") {
    const w1 = weeks[0]?.totalSets ?? 0;
    for (let i = 1; i < weeks.length; i++) {
      const wi = weeks[i]!.totalSets;
      if (w1 > 0 && (wi - w1) / w1 > 0.10) {
        out.push({
          kind: "block_purpose_mismatch",
          item: "maintenance_with_progression",
          week: weeks[i]!.weekIndex,
          detail: `Maintenance block; week ${weeks[i]!.weekIndex} volume ${wi} is >10% above week 1 (${w1}). Maintenance should not progress.`,
        });
      }
    }
    return out;
  }

  if (bp === "peaking") {
    const first = weeks[0];
    const last = weeks[weeks.length - 1];
    if (!first || !last) return out;
    if (first.totalSets > 0 && last.totalSets > first.totalSets * 0.75) {
      out.push({
        kind: "block_purpose_mismatch",
        item: "peaking_volume_not_descending",
        detail: `Peaking block; final week volume (${last.totalSets}) should be substantially below week 1 (${first.totalSets}). Got ${Math.round((last.totalSets / first.totalSets) * 100)}%.`,
      });
    }
    // Intensity should hold for the body of the block. The final week
    // of a peak is a deload/taper into competition — RPE drop in that
    // week is expected, not a flaw. Compare week 1 to the heaviest
    // non-final week.
    //
    // Bug fixed 2026-06-09: was comparing week 1 to the final week,
    // which flagged correct peaking-block deload tapers.
    if (weeks.length >= 2 && first.avgRpe !== null) {
      const midWeeks = weeks.slice(1, weeks.length - 1);
      const candidatePeak =
        midWeeks.length > 0
          ? midWeeks.reduce<number | null>(
              (best, w) => (w.avgRpe !== null && (best === null || w.avgRpe > best) ? w.avgRpe : best),
              null,
            )
          : first.avgRpe;
      if (candidatePeak !== null && first.avgRpe - candidatePeak > 1.0) {
        out.push({
          kind: "block_purpose_mismatch",
          item: "peaking_intensity_dropped",
          detail: `Peaking block; avg RPE fell from ${first.avgRpe.toFixed(1)} (week 1) to ${candidatePeak.toFixed(1)} (mid-block heaviest week). Intensity should hold across the body of a peaking block (the final taper is exempt).`,
        });
      }
    }
    return out;
  }

  if (bp === "on_ramp" || bp === "reconditioning") {
    // Should ascend across weeks — final week volume should exceed week 1.
    const first = weeks[0];
    const last = weeks[weeks.length - 1];
    if (first && last && weeks.length >= 2 && first.totalSets > 0 && last.totalSets <= first.totalSets) {
      out.push({
        kind: "block_purpose_mismatch",
        item: `${bp}_volume_not_ascending`,
        detail: `${bp} block; final week volume (${last.totalSets}) should exceed week 1 (${first.totalSets}). An on-ramp/reconditioning block builds up.`,
      });
    }
    return out;
  }

  return out;
}

// Rest-day count + required deload position.
//
// Rest days = calendarDays - trainingDays. Bug fixed 2026-06-09: previously
// we used days.length - trainingDays, which silently produced 0 rest days
// for any plan where the LLM enumerated only the training days (most do —
// Mon/Wed/Fri with explicit day_of_week). The aggregator now sets
// calendarDays to 7 when day_of_week is present.
function scoreRecoveryScheduling(scenario: Scenario, weeks: WeekAggregate[]): Violation[] {
  if (!scenario.block_purpose) return [];
  const out: Violation[] = [];
  const minRest = scenario.recovery_min_rest_days_per_week ?? 1;
  for (const w of weeks) {
    const rest = w.calendarDays - w.trainingDays;
    if (rest < minRest) {
      out.push({
        kind: "recovery_insufficient",
        item: "rest_days_below_minimum",
        week: w.weekIndex,
        detail: `Week ${w.weekIndex} has ${rest} rest day(s); scenario requires ≥${minRest}.`,
      });
    }
  }
  if (scenario.recovery_required_deload_at === "final_week" && weeks.length >= 2) {
    const last = weeks[weeks.length - 1]!;
    const penult = weeks[weeks.length - 2]!;
    if (penult.totalSets > 0 && last.totalSets >= penult.totalSets) {
      out.push({
        kind: "recovery_insufficient",
        item: "missing_final_week_deload",
        detail: `Final-week deload required; final week volume (${last.totalSets}) is not below the penultimate week (${penult.totalSets}).`,
      });
    }
  }
  return out;
}

// Week-over-week volume increase must not exceed the configured cap.
//
// Default cap is 40% — total weekly volume can legitimately rise that much
// when the trainer adds a training day or restores a deloaded exercise to
// full volume, both of which are normal in a short on-ramp / reconditioning
// block. The 10%/15% caps the spec doc proposed were treating total weekly
// volume like per-exercise progressive overload, which is the wrong unit
// (per-exercise loading rarely rises >5%/week, but adding a day is a one-
// time +30-40% step). Scenarios can override via progression_max_pct_per_week
// when a tighter cap is genuinely required (e.g. maintenance blocks at 5%).
//
// Bug fixed 2026-06-09.
function scoreProgressionRate(scenario: Scenario, weeks: WeekAggregate[]): Violation[] {
  if (!scenario.block_purpose) return [];
  // Skip for blocks where progression is not expected at all.
  if (scenario.block_purpose === "deload" || scenario.block_purpose === "maintenance") return [];
  const cap = scenario.progression_max_pct_per_week ?? 40;
  const out: Violation[] = [];
  for (let i = 1; i < weeks.length; i++) {
    const prev = weeks[i - 1]!;
    const cur = weeks[i]!;
    if (prev.totalSets <= 0) continue;
    const pct = ((cur.totalSets - prev.totalSets) / prev.totalSets) * 100;
    if (pct > cap) {
      out.push({
        kind: "progression_too_fast",
        item: `week_${cur.weekIndex}_volume_jump_${Math.round(pct)}pct`,
        week: cur.weekIndex,
        detail: `Volume rose ${Math.round(pct)}% from week ${prev.weekIndex} (${prev.totalSets} sets) to week ${cur.weekIndex} (${cur.totalSets} sets); cap is ${cap}%.`,
      });
    }
  }
  return out;
}

// On-ramp / reconditioning week 1 must operate light.
//
// Bug fixed 2026-06-09: the previous version included an "intensity ratio"
// check (week 1 avg RPE vs plan peak avg RPE, capped at e.g. 60%). RPE is a
// perceived-effort scale, not a load fraction — RPE 5 vs RPE 7 is not "5/7
// of working intensity" in any physiological sense. The ratio rule fired
// on plans that were genuinely well-paced (postpartum wk1 RPE 4.9 vs wk4
// peak RPE 7.0 → flagged at 71%, even though that's a textbook on-ramp).
// The absolute RPE-max rule (configurable via on_ramp_week_1_rpe_max,
// default 6) is the right gate; the ratio check has been removed.
function scoreOnRampPresent(scenario: Scenario, weeks: WeekAggregate[]): Violation[] {
  if (!scenario.block_purpose) return [];
  if (scenario.block_purpose !== "on_ramp" && scenario.block_purpose !== "reconditioning") return [];
  if (weeks.length === 0) return [];
  const w1 = weeks[0]!;
  const rpeMax = scenario.on_ramp_week_1_rpe_max ?? 6;
  const out: Violation[] = [];

  if (w1.maxRpe !== null && w1.maxRpe > rpeMax) {
    out.push({
      kind: "on_ramp_missing",
      item: "week_1_rpe_too_high",
      week: w1.weekIndex,
      detail: `Week 1 max RPE ${w1.maxRpe} exceeds on-ramp cap of ${rpeMax}.`,
    });
  }
  return out;
}

// Public entry point. Lane code calls this with whichever channels it has.
//
//   { lane: "A", rawText }                 — outcome_promise only
//   { lane: "B", wplJson }                 — all five rules
//
// Returns an empty array for scenarios without `block_purpose` set, which is
// the mechanism that keeps existing v0.5 / v0.6.0-anthropic numbers frozen.
export interface ShortPlanContext {
  lane: "A" | "B";
  rawText?: string | null;
  wplJson?: Record<string, unknown> | null;
}

export function scoreShortPlan(scenario: Scenario, ctx: ShortPlanContext): Violation[] {
  if (!scenario.block_purpose) return [];
  const violations: Violation[] = [];

  // Outcome-promise check on whatever text channel is available.
  let text = "";
  if (ctx.lane === "A" && typeof ctx.rawText === "string") text = ctx.rawText;
  if (ctx.lane === "B" && ctx.wplJson) text = collectPlanText(ctx.wplJson);
  violations.push(...scoreOutcomePromise(scenario, text));

  // Structural rules require the compiled plan tree — Lane B only.
  if (ctx.lane === "B" && ctx.wplJson) {
    const weeks = aggregateWeeks(ctx.wplJson);
    violations.push(...scoreBlockPurpose(scenario, weeks));
    violations.push(...scoreRecoveryScheduling(scenario, weeks));
    violations.push(...scoreProgressionRate(scenario, weeks));
    violations.push(...scoreOnRampPresent(scenario, weeks));
  }

  return violations;
}

// Exposed for unit tests so the rule layer can be tested independently of
// the public `scoreShortPlan` dispatch (which gates on lane + block_purpose
// presence). Each function takes the same inputs the dispatcher passes.
export const __test__ = {
  aggregateWeeks,
  collectPlanText,
  findOutcomePromises,
  scoreOutcomePromise,
  scoreBlockPurpose,
  scoreRecoveryScheduling,
  scoreProgressionRate,
  scoreOnRampPresent,
};
