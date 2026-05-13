// Cycle-aware programming helpers.
//
// Pure date arithmetic — no I/O, no global state. Used by the lane B
// runtime to compute per-day cycle position when applying conditional
// forbids, and by lane A scoring to project flow windows across a plan's
// duration when matching free-text violations against cycle-aware
// blacklists.
//
// All dates are handled as ISO-8601 date strings ("YYYY-MM-DD") at UTC
// midnight. We deliberately avoid timezone complexity — a fitness plan's
// "flow window" is a calendar-day concept, not a clock-time concept, and
// dragging timezone awareness in would create test fragility for no
// programming-relevant benefit.

import type { Cycle } from "./types.js";

const MS_PER_DAY = 86_400_000;

// Parse an ISO date string to a UTC midnight Date.
function parseIsoDate(s: string): Date {
  // Accept YYYY-MM-DD. Construct at UTC midnight to make day-count math
  // unambiguous.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`cycle: invalid ISO date "${s}"`);
  return new Date(Date.UTC(parseInt(m[1]!, 10), parseInt(m[2]!, 10) - 1, parseInt(m[3]!, 10)));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

// Returns true if cycle has the anchor + length data needed for date
// projection. Irregular and suppressed cycles return false and the
// runtime should fall back to non-projecting strategies.
export function isProjectable(cycle: Cycle): boolean {
  if (cycle.pattern === "suppressed" || cycle.pattern === "irregular") return false;
  if (!cycle.last_period_start) return false;
  if (!cycle.length_days || cycle.length_days <= 0) return false;
  return true;
}

// Given a date and a cycle anchor, return the 1-indexed cycle_day at that
// date. Returns null when the cycle isn't projectable (irregular or
// suppressed). Callers should check isProjectable() or handle null.
export function computeCycleDay(date: string | Date, cycle: Cycle): number | null {
  if (!isProjectable(cycle)) return null;
  const d = typeof date === "string" ? parseIsoDate(date) : date;
  const anchor = parseIsoDate(cycle.last_period_start!);
  const delta = daysBetween(anchor, d);
  const len = cycle.length_days!;
  const mod = ((delta % len) + len) % len;
  return mod + 1;
}

// Return true if the given date falls in a flow window (cycle_day
// 1..flow_days) OR inside any of the client's reported flare windows.
// Suppressed cycles always return false. Irregular cycles return true
// only on flare-window dates (since flow can't be projected).
export function isOnFlowDay(date: string | Date, cycle: Cycle): boolean {
  if (cycle.pattern === "suppressed") return false;
  const dStr = typeof date === "string" ? date : date.toISOString().slice(0, 10);
  // Client-reported flare windows override projection — strip even if
  // the cycle is otherwise irregular.
  if (cycle.flare_windows?.length) {
    for (const w of cycle.flare_windows) {
      if (dStr >= w.start && dStr <= w.end) return true;
    }
  }
  if (!isProjectable(cycle)) return false;
  const day = computeCycleDay(date, cycle);
  if (day === null) return false;
  return day >= 1 && day <= (cycle.flow_days ?? 0);
}

// Project all flow-day dates that fall in the inclusive range
// [startDate, endDate]. Used by Lane A scoring to know which calendar
// dates the model was supposed to phase around.
export function projectFlowWindows(
  startDate: string | Date,
  endDate: string | Date,
  cycle: Cycle,
): string[] {
  const start = typeof startDate === "string" ? parseIsoDate(startDate) : startDate;
  const end = typeof endDate === "string" ? parseIsoDate(endDate) : endDate;
  if (end < start) return [];
  const out: string[] = [];
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += MS_PER_DAY) {
    const d = new Date(cursor);
    if (isOnFlowDay(d, cycle)) out.push(isoDate(d));
  }
  return out;
}

// Compute the calendar date of a given (phase_order, week_in_phase,
// day_of_week_offset) tuple, given the plan's start date. Used by lane B
// when walking the compiled WPL JSON to anchor each Day to a real date.
//
// `dayOffsetInWeek` is 0..6 (Monday=0 by convention; trainers in our
// scenarios consistently use Monday as start-of-week). The function does
// not interpret WPL DSL DAY names — that's the caller's job, this is
// pure arithmetic.
export function dayDateForPlanPosition(
  planStart: string | Date,
  weeksBeforePhase: number,
  weekInPhase: number,
  dayOffsetInWeek: number,
): string {
  const start = typeof planStart === "string" ? parseIsoDate(planStart) : planStart;
  const totalDayOffset = (weeksBeforePhase + (weekInPhase - 1)) * 7 + dayOffsetInWeek;
  const d = new Date(start.getTime() + totalDayOffset * MS_PER_DAY);
  return isoDate(d);
}

// Map a WPL day_of_week token to a 0-based offset from Monday.
// Returns null for non-weekday tokens (REST, FLEX, etc.).
const DAY_OF_WEEK_MAP: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

export function dayOfWeekOffset(token: string | number | undefined | null): number | null {
  if (typeof token === "number") {
    // Numeric day_of_week (1=Monday in some conventions; 0=Sunday in
    // others). The WPL schema does not specify; treat 1..7 as Monday..
    // Sunday since that matches the YAML scenarios.
    if (token >= 1 && token <= 7) return (token - 1) % 7;
    return null;
  }
  if (typeof token !== "string") return null;
  const key = token.toLowerCase();
  return DAY_OF_WEEK_MAP[key] ?? null;
}
