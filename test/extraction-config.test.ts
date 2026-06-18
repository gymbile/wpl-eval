import { describe, it, expect } from "vitest";
import { EXTRACTOR_MODEL_NAME } from "../src/scoring/extraction.js";

describe("fixed extractor", () => {
  it("defaults to gpt-4.1 and is env-overridable", () => {
    expect(EXTRACTOR_MODEL_NAME).toBe(process.env["WPL_EVAL_EXTRACTOR_MODEL"] ?? "gpt-4.1");
  });

  it("importable without an API key (lazy construction)", () => {
    // If extraction.ts threw at import time (e.g. requireOpenAiKey() called
    // eagerly), this test file would fail to load. Reaching this assertion
    // confirms the module is safe to import in key-free test environments.
    expect(typeof EXTRACTOR_MODEL_NAME).toBe("string");
  });
});
