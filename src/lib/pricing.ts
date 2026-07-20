import type { ModelName } from "./types.js";

// Public price table, USD per million tokens. Single source of truth — when
// a vendor re-prices, this file changes and historic cost figures are
// recomputable from logged tokens without re-running the benchmark.
//
// OpenAI rows last verified: 2026-05-11. Source: openai.com/pricing.
// Anthropic rows last verified: 2026-06-03. Source:
//   platform.claude.com/docs/en/about-claude/pricing.
//   Note: Opus 4.7 uses a new tokenizer (vs. Opus 4.1 and prior) that may
//   consume up to ~35% more tokens for the same fixed text — factor that
//   into cross-tier cost comparisons in INDUSTRY_REPORT.md.
// Gemini rows last verified: 2026-07-20. Source: ai.google.dev/gemini-api/docs/pricing.
const PRICING: Record<string, { input_per_m: number; output_per_m: number }> = {
  "gpt-5": { input_per_m: 1.25, output_per_m: 10.0 },
  "gpt-5-mini": { input_per_m: 0.25, output_per_m: 2.0 },
  "gpt-5-nano": { input_per_m: 0.05, output_per_m: 0.4 },
  "gpt-4.1": { input_per_m: 2.0, output_per_m: 8.0 },
  // Out-of-sweep models supported for ad-hoc smoke tests.
  "gpt-4o-mini": { input_per_m: 0.15, output_per_m: 0.6 },
  "gpt-4o": { input_per_m: 2.5, output_per_m: 10.0 },
  // Anthropic Claude (v0.6 sweep).
  "claude-opus-4-7": { input_per_m: 5.0, output_per_m: 25.0 },
  "claude-sonnet-4-6": { input_per_m: 3.0, output_per_m: 15.0 },
  "claude-haiku-4-5-20251001": { input_per_m: 1.0, output_per_m: 5.0 },
  // Google Gemini (v0.7 sweep). Rows last verified: 2026-07-20. Source:
  //   ai.google.dev/gemini-api/docs/pricing (paid tier; pro row is the
  //   <=200k-prompt tier — eval prompts are far below 200k).
  "gemini-2.5-pro": { input_per_m: 1.25, output_per_m: 10.0 },
  "gemini-2.5-flash": { input_per_m: 0.3, output_per_m: 2.5 },
  "gemini-2.5-flash-lite": { input_per_m: 0.1, output_per_m: 0.4 },
};

export function costUsd(model: ModelName, tokensIn: number, tokensOut: number): number {
  const p = PRICING[model];
  if (!p) return 0; // unpriced model — cost figure is omitted, surface explicitly in reports
  return (tokensIn * p.input_per_m + tokensOut * p.output_per_m) / 1_000_000;
}

export function isPriced(model: ModelName): boolean {
  return model in PRICING;
}

export function pricingTable(): typeof PRICING {
  return PRICING;
}
