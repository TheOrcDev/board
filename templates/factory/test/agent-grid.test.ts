import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GRID_CONTEXT_WINDOW_TOKENS } from "../lib/openai-compatible.ts";

const agent = readFileSync(new URL("../agent/agent.ts", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

test("agent.ts is the Grid on-camera swap, not a hard-coded Anthropic model", () => {
  assert.match(agent, /from "@ai-sdk\/openai-compatible"/);
  assert.match(agent, /createOpenAICompatible/);
  assert.match(agent, /name: "the-grid"/);
  assert.match(agent, /baseURL: "https:\/\/api\.thegrid\.ai\/v1"/);
  assert.match(agent, /apiKey: process\.env\.GRID_API_KEY/);
  assert.match(agent, /grid\(process\.env\.GRID_MODEL \?\? "text-prime"\)/);
  assert.match(agent, /modelContextWindowTokens: 196_608/);
  assert.match(agent, /externalDependencies: \["@ai-sdk\/openai-compatible"\]/);
  assert.match(agent, /sessionUsage: \(\) => false/);
  assert.equal(agent.includes("anthropic/claude-opus-5.5"), false);
  assert.equal(agent.includes("sk-"), false);
  assert.equal(/GRID_API_KEY\s*=\s*["'][^"']+["']/.test(agent), false);
  assert.equal(GRID_CONTEXT_WINDOW_TOKENS, 196_608);
});

test("the factory depends on the OpenAI-compatible provider, and the env example has GRID_API_KEY empty", () => {
  assert.ok(pkg.dependencies["@ai-sdk/openai-compatible"]);
  assert.match(envExample, /^GRID_API_KEY=$/m);
  assert.match(envExample, /^GRID_MODEL=text-prime$/m);
});
