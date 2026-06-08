// END-markers → canonical indented WPL-AI DSL re-indenter.
//
// Experiment for v0.6: testing whether removing the indentation
// discipline from the DSL the LLM produces lowers the compile-error
// rate. The LLM is prompted to emit a flat (no leading whitespace)
// form with explicit `END <BLOCK>` markers; this function converts
// that form back to the canonical indented DSL the wpl-ai compiler
// accepts.
//
// Block openers (need an indented child region in canonical form):
//   PLAN "..."          → PLAN "..." (no colon, children at depth+1)
//   GOALS               → GOALS     (no colon, children at depth+1)
//   GOAL <slug>         → GOAL <slug>: (colon, children at depth+1)
//   PHASES              → PHASES    (no colon, children at depth+1)
//   PHASE "..." (N weeks)→ PHASE "..." (N weeks): (colon)
//   WEEK <n>            → WEEK <n>:
//   DAY <day> <kind> <duration> "..." → DAY ...:
//   WARMUP              → warmup:
//   MAIN <kind>         → main <kind>:
//   COOLDOWN            → cooldown:
//
// Block closers (consumed; not emitted in canonical form):
//   END PLAN / END GOALS / END GOAL / END PHASES / END PHASE /
//   END WEEK / END DAY / END WARMUP / END MAIN / END COOLDOWN

const NO_COLON_OPENERS = new Set(["PLAN", "GOALS", "PHASES"]);

// PLAN is special — it is the document root in canonical form, so its
// "children" (TYPE / VISIBILITY / GOALS / PHASES) sit at depth 0, not
// at depth 1. We still match `END PLAN` and consume it; we just don't
// push PLAN onto the depth stack.
const NON_DEPTH_OPENERS = new Set(["PLAN"]);

// Block-opener keywords we recognize. A line is treated as a block
// opener if its first whitespace-separated token matches one of
// these.
const OPENER_FIRST_TOKENS = new Set([
  "PLAN",
  "GOALS",
  "GOAL",
  "PHASES",
  "PHASE",
  "WEEK",
  "DAY",
  "WARMUP",
  "MAIN",
  "COOLDOWN",
]);

const CLOSER_TOKENS = new Set([
  "END PLAN",
  "END GOALS",
  "END GOAL",
  "END PHASES",
  "END PHASE",
  "END WEEK",
  "END DAY",
  "END WARMUP",
  "END MAIN",
  "END COOLDOWN",
]);

// In canonical form some openers lowercase their keyword (warmup/main/
// cooldown) instead of the UPPER form the LLM emitted. Map them back.
function canonicalizeOpener(line: string): string {
  if (line.startsWith("WARMUP")) return "warmup" + line.slice("WARMUP".length);
  if (line.startsWith("MAIN ")) return "main " + line.slice("MAIN ".length);
  if (line === "MAIN") return "main";
  if (line.startsWith("COOLDOWN")) return "cooldown" + line.slice("COOLDOWN".length);
  return line;
}

function needsColon(line: string): boolean {
  const first = line.split(/\s+/)[0];
  if (first === undefined) return false;
  return !NO_COLON_OPENERS.has(first);
}

function indentOf(depth: number): string {
  return "  ".repeat(depth);
}

const PLAN_SENTINEL = "__PLAN_NO_DEPTH__";

// The visible indentation depth is the count of stack entries that
// actually contribute to the column position — the PLAN sentinel is
// tracked for END-matching purposes but does not indent its children.
function effectiveDepth(stack: string[]): number {
  let d = 0;
  for (const s of stack) if (s !== PLAN_SENTINEL) d++;
  return d;
}

export interface ReindentResult {
  ok: boolean;
  canonical: string;
  // Diagnostics: each surfaces an issue the LLM caused that we recovered
  // from (or failed to recover from). Empty list = clean transform.
  warnings: string[];
}

export function reindentEndMarkersDsl(input: string): ReindentResult {
  // Tolerate any incidental leading whitespace the LLM may have left.
  const raw = input
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .map((l) => l.replace(/^\s+/, ""));

  const out: string[] = [];
  const warnings: string[] = [];
  const stack: string[] = []; // names of currently-open blocks (top is innermost)

  for (let i = 0; i < raw.length; i++) {
    const line = raw[i]!;
    if (line === "") {
      // preserve blank lines for readability at the current depth — empty
      out.push("");
      continue;
    }

    // Closer?
    // Match either the canonical two-token form ("END PHASE") or a tolerant
    // form where the LLM used `END_PHASE` or `END  PHASE` etc.
    const closerMatch = line.match(/^END[\s_]+([A-Z]+)\b/);
    if (closerMatch) {
      const closing = `END ${closerMatch[1]}`;
      if (!CLOSER_TOKENS.has(closing)) {
        warnings.push(`unknown closer at line ${i + 1}: ${line}`);
        // Treat as a leaf — emit at current depth, don't change depth
        out.push(indentOf(effectiveDepth(stack)) + line);
        continue;
      }
      // Pop matching scope. If top of stack doesn't match, search down
      // (forgiveness for skipped closers). PLAN is tracked on the stack
      // as the sentinel, so translate before searching.
      const rawExpected = closerMatch[1]!;
      const expectedToken = rawExpected === "PLAN" ? PLAN_SENTINEL : rawExpected;
      const idx = [...stack].reverse().findIndex((s) => s === expectedToken);
      if (idx === -1) {
        warnings.push(`unmatched ${closing} at line ${i + 1} (stack: ${stack.join("/")})`);
        continue;
      }
      const popCount = idx + 1;
      if (popCount > 1) {
        warnings.push(`skipping ${popCount - 1} unclosed block(s) before ${closing} at line ${i + 1}`);
      }
      for (let p = 0; p < popCount; p++) stack.pop();
      // Closers are consumed; not emitted in canonical form.
      continue;
    }

    // Opener?
    const firstToken = line.split(/\s+/)[0];
    if (firstToken !== undefined && OPENER_FIRST_TOKENS.has(firstToken)) {
      const emitted = canonicalizeOpener(line) + (needsColon(line) ? ":" : "");
      out.push(indentOf(effectiveDepth(stack)) + emitted);
      if (!NON_DEPTH_OPENERS.has(firstToken)) {
        stack.push(firstToken);
      } else {
        // Track PLAN on a separate "skip-depth" marker so that END PLAN
        // is still recognized as legitimate (otherwise the closer logic
        // would warn "unmatched END PLAN at EOF").
        stack.push("__PLAN_NO_DEPTH__");
      }
      continue;
    }

    // Leaf line — emit at current depth.
    out.push(indentOf(effectiveDepth(stack)) + line);
  }

  if (stack.length > 0) {
    warnings.push(`unclosed at EOF: ${stack.join("/")}`);
  }

  return {
    ok: warnings.length === 0,
    canonical: out.join("\n"),
    warnings,
  };
}
