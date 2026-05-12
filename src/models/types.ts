import type { ModelName } from "../lib/types.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  max_output_tokens?: number;
}

export interface ChatResult {
  text: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  refusal: boolean;
}

export interface Model {
  name: ModelName;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;
}
