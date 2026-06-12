import { describe, it, expect } from "vitest";
import { selectLatestValidTurn } from "../src/lanes/lane-b.js";

type TurnLike = { wpl_valid: boolean };

describe("latest-valid-turn selection", () => {
  it("picks the last turn that compiled", () => {
    const turns: TurnLike[] = [
      { wpl_valid: true },
      { wpl_valid: false },
      { wpl_valid: true },
      { wpl_valid: false },
    ];
    expect(selectLatestValidTurn(turns)).toBe(2);
  });
  it("returns null when no turn compiled", () => {
    expect(selectLatestValidTurn([{ wpl_valid: false }])).toBe(null);
  });
  it("returns 0 when only first turn compiled", () => {
    const turns: TurnLike[] = [
      { wpl_valid: true },
      { wpl_valid: false },
    ];
    expect(selectLatestValidTurn(turns)).toBe(0);
  });
  it("returns last index when all turns compiled", () => {
    const turns: TurnLike[] = [
      { wpl_valid: true },
      { wpl_valid: true },
      { wpl_valid: true },
    ];
    expect(selectLatestValidTurn(turns)).toBe(2);
  });
  it("returns null for empty array", () => {
    expect(selectLatestValidTurn([])).toBe(null);
  });
});
