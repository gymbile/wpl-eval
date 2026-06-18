#!/usr/bin/env node
// GENERATOR for src/scoring/matcher-vocab.generated.ts — reads the vendored
// matcher vocab and (re)writes the generated TS module. Deterministic: emits
// tokens in JSON order. Run: npm run gen:matcher-vocab
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(root, "src/data/matcher-vocab.json"), "utf8"));

const tokens = data.qualifier_tokens.map((t) => `  ${JSON.stringify(t)},`).join("\n");
const plurals = Object.entries(data.short_plurals)
  .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  .join("\n");

const out = `// GENERATED — do not edit. Run \`npm run gen:matcher-vocab\` to regenerate.
// Source of truth: wpl/data/matcher-vocab.json (vendored at src/data/matcher-vocab.json).
// Vocab version: ${data.version}

export const QUALIFIER_TOKENS_LIST: readonly string[] = [
${tokens}
];

export const SHORT_PLURALS: Record<string, string> = {
${plurals}
};
`;

writeFileSync(join(root, "src/scoring/matcher-vocab.generated.ts"), out);
console.log(`wrote src/scoring/matcher-vocab.generated.ts (${data.version})`);
