import { describe, it, expect } from "vitest";
import { splitForGemini } from "../src/models/gemini.js";
import { isPriced } from "../src/lib/pricing.js";
import type { ChatMessage } from "../src/models/types.js";

describe("splitForGemini", () => {
  it("extracts system instruction and maps assistant→model", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys A" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
    ];
    const { systemInstruction, contents } = splitForGemini(messages);
    expect(systemInstruction).toBe("sys A");
    expect(contents).toEqual([
      { role: "user", parts: [{ text: "u1" }] },
      { role: "model", parts: [{ text: "a1" }] },
      { role: "user", parts: [{ text: "u2" }] },
    ]);
  });
  it("concatenates multiple system messages", () => {
    const { systemInstruction } = splitForGemini([
      { role: "system", content: "one" },
      { role: "system", content: "two" },
      { role: "user", content: "u" },
    ]);
    expect(systemInstruction).toBe("one\n\ntwo");
  });
});

describe("pricing", () => {
  it("all three Gemini sweep models are priced", () => {
    expect(isPriced("gemini-3.1-pro-preview")).toBe(true);
    expect(isPriced("gemini-3.5-flash")).toBe(true);
    expect(isPriced("gemini-3.1-flash-lite")).toBe(true);
  });
});
