import Anthropic from "@anthropic-ai/sdk";
import { requireAnthropicKey } from "../lib/env.js";
import type { ModelName } from "../lib/types.js";
import type { ChatMessage, ChatOptions, ChatResult, Model } from "./types.js";

// Heuristic refusal detection — mirrors the OpenAI adapter so the `refusal`
// field is comparable across vendors. Anthropic refusals tend to lead with
// "I can't" / "I'm not able to" the same as OpenAI.
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

// Anthropic's Messages API takes system as a top-level param, not a message.
// We split the incoming ChatMessage[] into a concatenated system string +
// alternating user/assistant turns.
function splitSystem(messages: ChatMessage[]): {
  system: string | undefined;
  turns: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systemParts: string[] = [];
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
    } else {
      turns.push({ role: m.role, content: m.content });
    }
  }
  const system = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;
  return { system, turns };
}

// Pull text out of Anthropic's content-block response. The Messages API can
// return tool_use / thinking / other block types; we only care about text.
function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export function makeAnthropicModel(name: ModelName): Model {
  const client = new Anthropic({ apiKey: requireAnthropicKey() });

  return {
    name,
    async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
      const started = Date.now();
      const { system, turns } = splitSystem(messages);

      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: name,
        max_tokens: opts.max_output_tokens ?? 4096,
        temperature: opts.temperature ?? 0,
        messages: turns,
        ...(system ? { system } : {}),
      };

      const response = await client.messages.create(params);
      const latency_ms = Date.now() - started;

      const text = extractText(response.content);

      return {
        text,
        tokens_in: response.usage.input_tokens,
        tokens_out: response.usage.output_tokens,
        latency_ms,
        refusal: looksLikeRefusal(text),
      };
    },
  };
}
