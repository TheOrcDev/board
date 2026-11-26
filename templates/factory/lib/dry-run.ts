import type { Board, MessageView } from "@vercel/board";
import { agentBoard } from "../agent/lib/vb-tool.ts";
import { channel } from "./project.ts";
import {
  DEFAULT_GRID_MODEL,
  GRID_BASE_URL,
  gridInstrument,
  pingOpenAICompatible,
  serveMockOpenAI,
  type ChatCompletion,
} from "./openai-compatible.ts";

// A local stand-in for Demo 4: an Orcanva issue lands on the board, the agent reacts with eyes,
// says what it reproduced, and replies with a pull request link. The real agent does this from a
// GitHub issue once Connect is on. This path needs no Vercel project, no Grid key, and no GitHub.

export const ORCANVA_REPO = "TheOrcDev/orcanva";

export const orcanvaChannel = (env: Record<string, string | undefined> = process.env): string => channel("orcanva", env);

/** What a person would open as a GitHub issue on Orcanva. The dry-run posts this as the thread. */
export const DEMO_ISSUE_TITLE = "Duration badge on YouTube preview vanishes on light thumbnails";

export const DEMO_ISSUE_BODY = `Open a YouTube thumbnail that's mostly white or yellow, then open YouTube preview.

The duration badge in the bottom-right of the thumbnail is hard to read. YouTube's own badge is a dark pill with white text, so it stays readable on any thumbnail.

Expected: a dark translucent pill (like YouTube) so the duration stays readable on a light thumbnail.

Steps:
1. Studio → a light or yellow thumbnail
2. Open YouTube preview
3. Look at the duration in the corner of the card`;

export const demoIssueText = (): string => `Issue: ${DEMO_ISSUE_TITLE}\nhttps://github.com/${ORCANVA_REPO}/issues (draft, not opened)\n\n${DEMO_ISSUE_BODY}`;

const REPRODUCED = "Reproduced on a light thumbnail: the duration in the corner disappears. Fixing it as a dark pill, like YouTube.";
const PR_REPLY = "Opened the fix: https://github.com/TheOrcDev/orcanva/pull/0 (dry-run, no real PR).";

export type DryRun = {
  channel: string;
  root: MessageView;
  replies: MessageView[];
  eyes: boolean;
  model: ChatCompletion;
};

/** Posts the demo issue, then writes as the factory agent: 👀, a reproduction, a PR link. */
export async function runBoardFlow(team: Board, env: Record<string, string | undefined> = process.env): Promise<Omit<DryRun, "model">> {
  const dest = orcanvaChannel(env);
  const agent = agentBoard(team);
  const root = await team.post(dest, {
    text: demoIssueText(),
    labels: { issue: `${ORCANVA_REPO}#demo`, state: "open" },
  });
  await agent.react(root.id, "eyes");
  await agent.reply(root.id, REPRODUCED);
  await agent.reply(root.id, PR_REPLY);
  const thread = await agent.thread(root.id);
  const eyes = Boolean(thread.message.reactions?.eyes?.length);
  return { channel: dest, root: thread.message, replies: thread.replies, eyes };
}

/**
 * One OpenAI-compatible request in the same shape the agent uses. With GRID_API_KEY, that's The
 * Grid. Without it, a mock server on localhost, so the flow can be checked before a key exists.
 */
export async function pingModel(env: Record<string, string | undefined> = process.env): Promise<ChatCompletion> {
  const model = gridInstrument(env);
  if (env.GRID_API_KEY) {
    return pingOpenAICompatible({
      baseURL: GRID_BASE_URL,
      apiKey: env.GRID_API_KEY,
      model,
      messages: [{ role: "user", content: "Reply with the single word pong." }],
    });
  }
  const mock = await serveMockOpenAI("pong");
  try {
    return await pingOpenAICompatible({
      baseURL: mock.url,
      apiKey: "mock",
      model: model || DEFAULT_GRID_MODEL,
      messages: [{ role: "user", content: "ping" }],
      mocked: true,
    });
  } finally {
    await mock.close();
  }
}

export async function runDryRun(team: Board, env: Record<string, string | undefined> = process.env): Promise<DryRun> {
  const board = await runBoardFlow(team, env);
  const model = await pingModel(env);
  return { ...board, model };
}
