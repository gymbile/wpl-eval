import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { QUALIFIER_TOKENS_LIST, SHORT_PLURALS } from "../src/scoring/matcher-vocab.generated.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("matcher-vocab codegen", () => {
  it("committed generated module equals a fresh codegen run", () => {
    const path = join(root, "src/scoring/matcher-vocab.generated.ts");
    const before = readFileSync(path, "utf8");
    execFileSync("node", ["scripts/gen-matcher-vocab.mjs"], { cwd: root });
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("exposes the 16 qualifier tokens and the short-plural override", () => {
    const json = JSON.parse(readFileSync(join(root, "src/data/matcher-vocab.json"), "utf8"));
    expect(QUALIFIER_TOKENS_LIST).toEqual(json.qualifier_tokens);
    expect(QUALIFIER_TOKENS_LIST.length).toBe(16);
    expect(SHORT_PLURALS).toEqual({ ups: "up" });
  });
});
