import { GoogleGenAI } from "@google/genai";
import { requireGeminiKey } from "../lib/env.js";
import type { ModelName } from "../lib/types.js";
import type { ChatMessage, ChatOptions, ChatResult, Model } from "./types.js";

// Heuristic refusal detection — same markers as the OpenAI and Anthropic
// adapters so the `refusal` field is comparable across all three vendors.
const REFUSAL_MARKERS = [
  /^I (?:can(?:'|no)?t|won'?t|am unable to)\b/i,
  /\bI'?m not (?:able|going) to\b/i,
  /\bplease consult (?:a|your) (?:doctor|physician|healthcare)/i,
  /\bI cannot (?:provide|generate|create)\b/i,
];

function looksLikeRefusal(text: string): boolean {
  const head = text.slice(0, 400);
  return REFUSAL_MARKERS.some((re) => re.test(head));
}

// Gemini's generateContent takes systemInstruction as config, and content
// turns with role "user" | "model". Split our ChatMessage[] accordingly.
// Exported for unit tests.
export function splitForGemini(messages: ChatMessage[]): {
  systemInstruction: string | undefined;
  contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
} {
  const systemParts: string[] = [];
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
    } else {
      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      });
    }
  }
  return {
    systemInstruction: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    contents,
  };
}

export function makeGeminiModel(name: ModelName): Model {
  const client = new GoogleGenAI({ apiKey: requireGeminiKey() });

  return {
    name,
    async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
      const started = Date.now();
      const { systemInstruction, contents } = splitForGemini(messages);

      const response = await client.models.generateContent({
        model: name,
        contents,
        config: {
          temperature: opts.temperature ?? 0,
          maxOutputTokens: opts.max_output_tokens ?? 4096,
          // Cap thinking so it can't consume the whole output budget:
          // Gemini 2.5 thinking tokens count against maxOutputTokens, and
          // pro's default dynamic thinking can return EMPTY text after
          // burning the entire budget — which the eval would misread as a
          // compile failure. 1024 keeps some deliberation while
          // guaranteeing headroom for the actual plan.
          thinkingConfig: { thinkingBudget: 1024 },
          ...(systemInstruction ? { systemInstruction } : {}),
        },
      });
      const latency_ms = Date.now() - started;

      const text = response.text ?? "";
      const usage = response.usageMetadata;

      return {
        text,
        tokens_in: usage?.promptTokenCount ?? 0,
        // Include thinking tokens when present — they are billed as output.
        tokens_out: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
        latency_ms,
        refusal: looksLikeRefusal(text),
      };
    },
  };
}
