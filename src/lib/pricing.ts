import type { ModelName } from "./types.js";

// OpenAI public price table, USD per million tokens. Single source of truth —
// when OpenAI re-prices, this file changes and historic cost figures are
// recomputable from logged tokens without re-running the benchmark.
//
// Last verified: 2026-05-11. Source: openai.com/pricing.
const PRICING: Record<string, { input_per_m: number; output_per_m: number }> = {
  "gpt-5": { input_per_m: 1.25, output_per_m: 10.0 },
  "gpt-5-mini": { input_per_m: 0.25, output_per_m: 2.0 },
  "gpt-5-nano": { input_per_m: 0.05, output_per_m: 0.4 },
  "gpt-4.1": { input_per_m: 2.0, output_per_m: 8.0 },
  // Out-of-sweep models supported for ad-hoc smoke tests.
  "gpt-4o-mini": { input_per_m: 0.15, output_per_m: 0.6 },
  "gpt-4o": { input_per_m: 2.5, output_per_m: 10.0 },
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
