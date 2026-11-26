import assert from "node:assert/strict";
import { test } from "node:test";
import { board } from "@vercel/board";
import { local } from "@vercel/board/backend-local";
import { DEMO_ISSUE_TITLE, ORCANVA_REPO, orcanvaChannel, runBoardFlow, runDryRun } from "../lib/dry-run.ts";
import { DEFAULT_GRID_MODEL, FALLBACK_GRID_MODEL, GRID_BASE_URL, GRID_CONTEXT_WINDOW_TOKENS, gridInstrument, pingOpenAICompatible, serveMockOpenAI } from "../lib/openai-compatible.ts";

test("Orcanva's board channel is under this factory, named for the project", () => {
  assert.equal(orcanvaChannel({ VERCEL_PROJECT_NAME: "factory" }), "project-factory/orcanva");
  assert.equal(orcanvaChannel({ VERCEL_PROJECT_NAME: "orcanva-factory" }), "project-orcanva-factory/orcanva");
});

test("The Grid's prime instruments share a 196,608 token context window, and agent-prime is a one-word switch", () => {
  assert.equal(GRID_BASE_URL, "https://api.thegrid.ai/v1");
  assert.equal(GRID_CONTEXT_WINDOW_TOKENS, 196_608);
  assert.equal(gridInstrument({}), DEFAULT_GRID_MODEL);
  assert.equal(gridInstrument({ GRID_MODEL: FALLBACK_GRID_MODEL }), FALLBACK_GRID_MODEL);
  assert.equal(DEFAULT_GRID_MODEL, "text-prime");
  assert.equal(FALLBACK_GRID_MODEL, "agent-prime");
});

test("an Orcanva issue on a local board gets eyes, a reproduction, and a PR link from the agent", async () => {
  const team = board({ backend: local({ memory: true }) });
  const result = await runBoardFlow(team);
  assert.equal(result.channel, "project-factory/orcanva");
  assert.match(result.root.text, new RegExp(DEMO_ISSUE_TITLE));
  assert.equal(result.root.labels.issue, `${ORCANVA_REPO}#demo`);
  assert.equal(result.root.channel, "project-factory/orcanva");
  assert.equal(result.eyes, true);
  assert.equal(result.replies.length, 2);
  assert.match(result.replies[0]!.text, /[Rr]eproduced/);
  assert.match(result.replies[1]!.text, /github\.com\/TheOrcDev\/orcanva\/pull/);
  assert.equal(result.replies[0]!.by.actor, (await team.me()).actor);
});

test("without GRID_API_KEY, the model ping uses a mock OpenAI-compatible server", async () => {
  const before = process.env.GRID_API_KEY;
  delete process.env.GRID_API_KEY;
  try {
    const team = board({ backend: local({ memory: true }) });
    const result = await runDryRun(team, { GRID_MODEL: "text-prime" });
    assert.equal(result.model.mocked, true);
    assert.equal(result.model.model, "text-prime");
    assert.match(result.model.text, /pong/i);
    assert.equal(result.eyes, true);
  } finally {
    if (before === undefined) delete process.env.GRID_API_KEY;
    else process.env.GRID_API_KEY = before;
  }
});

test("the mock OpenAI-compatible server answers chat/completions with the requested model", async () => {
  const mock = await serveMockOpenAI("ok");
  try {
    const completion = await pingOpenAICompatible({
      baseURL: mock.url,
      apiKey: "mock",
      model: "agent-prime",
      messages: [{ role: "user", content: "hi" }],
      mocked: true,
    });
    assert.equal(completion.model, "agent-prime");
    assert.equal(completion.text, "ok");
    assert.equal(completion.mocked, true);
  } finally {
    await mock.close();
  }
});
