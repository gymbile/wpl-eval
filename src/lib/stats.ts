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
