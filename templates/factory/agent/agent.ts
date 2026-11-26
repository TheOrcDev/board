import { defineAgent } from "eve";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const grid = createOpenAICompatible({
  name: "the-grid",
  baseURL: "https://api.thegrid.ai/v1",
  apiKey: process.env.GRID_API_KEY,
});

export default defineAgent({
  // text-prime matches the on-camera swap. Set GRID_MODEL=agent-prime if tool calls struggle.
  model: grid(process.env.GRID_MODEL ?? "text-prime"),
  // Text Prime, Code Prime, and Agent Prime are all ≥ 196,608 tokens.
  modelContextWindowTokens: 196_608,
  limits: {
    // No spending cap: at a cap, eve pauses the session to ask a person whether to go on, and here
    // nobody sees that question (messages come from the board's watcher, not a chat), so the
    // thread's agent would stall for good.
    sessionUsage: () => false,
  },
  build: {
    externalDependencies: ["@ai-sdk/openai-compatible"],
  },
});
