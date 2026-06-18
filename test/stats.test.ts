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
    expect(all.hi).toBeCloseTo(1, 5);
    expect(all.lo).toBeGreaterThan(0.6);
  });
});
