import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

// Load .env from local first (public reproducers add their own key) then fall
// back to the parent gymbile_backend/.env for local development. Never copy or
// commit the real key — the wpl-eval repo is public.
const localEnv = resolve(process.cwd(), ".env");
const backendEnv = resolve(process.cwd(), "../../gymbile_backend/.env");

const chosenPath = existsSync(localEnv)
  ? localEnv
  : existsSync(backendEnv)
    ? backendEnv
    : null;

if (chosenPath) {
  config({ path: chosenPath });
}

export function requireOpenAiKey(): string {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to ./.env (preferred for public reproducers) " +
        "or ../../gymbile_backend/.env (local dev fallback).",
    );
  }
  return key;
}

export function requireAnthropicKey(): string {
  const key = process.env["ANTHROPIC_API_KEY"];
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to ./.env (preferred for public reproducers) " +
        "or ../../gymbile_backend/.env (local dev fallback).",
    );
  }
  return key;
}
