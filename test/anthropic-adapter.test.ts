import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock the Anthropic SDK before importing the adapter. The mock exposes the
// `create` spy so each test can assert what was passed to the API and what
// shape it returned.
const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
      constructor(_opts: { apiKey: string }) {
        // no-op; just verifies the adapter passes an apiKey
      }
    },
  };
});

// Stub the env var so requireAnthropicKey() succeeds inside the adapter.
beforeEach(() => {
  process.env["ANTHROPIC_API_KEY"] = "test-key";
  mockCreate.mockReset();
});

// Import AFTER the mock is registered.
const { makeAnthropicModel } = await import("../src/models/anthropic.js");

function fakeResponse(opts: {
  text?: string;
  input_tokens?: number;
  output_tokens?: number;
}) {
  return {
    content: opts.text === undefined ? [] : [{ type: "text", text: opts.text }],
    usage: {
      input_tokens: opts.input_tokens ?? 100,
      output_tokens: opts.output_tokens ?? 200,
    },
    stop_reason: "end_turn",
  };
}

describe("anthropic adapter — basic shape", () => {
  test("happy path returns text + token counts + latency + refusal=false", async () => {
    mockCreate.mockResolvedValueOnce(
      fakeResponse({ text: "Here is a 12-week plan...", input_tokens: 150, output_tokens: 800 }),
    );
    const model = makeAnthropicModel("claude-sonnet-4-6");
    const result = await model.chat([{ role: "user", content: "Build a plan" }]);

    expect(result.text).toBe("Here is a 12-week plan...");
    expect(result.tokens_in).toBe(150);
    expect(result.tokens_out).toBe(800);
    expect(result.refusal).toBe(false);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  test("forwards temperature and max_output_tokens; defaults temperature=0", async () => {
    mockCreate.mockResolvedValueOnce(fakeResponse({ text: "ok" }));
    const model = makeAnthropicModel("claude-haiku-4-5-20251001");
    await model.chat([{ role: "user", content: "x" }], { max_output_tokens: 8192 });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const params = mockCreate.mock.calls[0]![0];
    expect(params.model).toBe("claude-haiku-4-5-20251001");
    expect(params.temperature).toBe(0);
    expect(params.max_tokens).toBe(8192);
  });

  test("hoists system messages into the top-level `system` param", async () => {
    mockCreate.mockResolvedValueOnce(fakeResponse({ text: "ok" }));
    const model = makeAnthropicModel("claude-opus-4-7");
    await model.chat([
      { role: "system", content: "You are a personal trainer." },
      { role: "system", content: "Follow ACOG guidelines." },
      { role: "user", content: "Plan for a postpartum client" },
      { role: "assistant", content: "Sure, here you go..." },
      { role: "user", content: "Continue from week 4" },
    ]);

    const params = mockCreate.mock.calls[0]![0];
    // System parts concatenated, in original order.
    expect(params.system).toBe("You are a personal trainer.\n\nFollow ACOG guidelines.");
    // User/assistant turns preserved, in order, with no system mixed in.
    expect(params.messages).toEqual([
      { role: "user", content: "Plan for a postpartum client" },
      { role: "assistant", content: "Sure, here you go..." },
      { role: "user", content: "Continue from week 4" },
    ]);
  });

  test("flags refusals via the shared heuristic markers", async () => {
    mockCreate.mockResolvedValueOnce(
      fakeResponse({ text: "I can't provide medical advice for that condition. Please consult your doctor." }),
    );
    const model = makeAnthropicModel("claude-sonnet-4-6");
    const result = await model.chat([{ role: "user", content: "x" }]);
    expect(result.refusal).toBe(true);
  });

  test("omits `temperature` for Opus 4.7+ (parameter deprecated by the API)", async () => {
    // Anthropic returns 400 "`temperature` is deprecated for this model."
    // for Opus 4.7 and later. The adapter must omit the field for those
    // models even if the caller passes one — disclosed in METHODOLOGY.md
    // as a per-model determinism asymmetry vs. the OpenAI lane.
    mockCreate.mockResolvedValueOnce(fakeResponse({ text: "ok" }));
    const opus = makeAnthropicModel("claude-opus-4-7");
    await opus.chat([{ role: "user", content: "x" }], { temperature: 0 });
    const params = mockCreate.mock.calls[0]![0];
    expect("temperature" in params).toBe(false);

    // Sonnet must still forward temperature — the omission is Opus-only.
    mockCreate.mockResolvedValueOnce(fakeResponse({ text: "ok" }));
    const sonnet = makeAnthropicModel("claude-sonnet-4-6");
    await sonnet.chat([{ role: "user", content: "x" }]);
    const sonnetParams = mockCreate.mock.calls[1]![0];
    expect(sonnetParams.temperature).toBe(0);
  });

  test("concatenates multiple text content blocks; ignores non-text blocks", async () => {
    // Anthropic can return content as multiple blocks; we should join all
    // text blocks and silently drop tool_use / thinking blocks rather than
    // letting them poison the extracted plan.
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: "text", text: "Week 1:\n" },
        { type: "tool_use", id: "t1", name: "noop", input: {} },
        { type: "text", text: "Week 2:" },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
      stop_reason: "end_turn",
    });
    const model = makeAnthropicModel("claude-sonnet-4-6");
    const result = await model.chat([{ role: "user", content: "x" }]);
    expect(result.text).toBe("Week 1:\nWeek 2:");
    expect(result.refusal).toBe(false);
  });
});
