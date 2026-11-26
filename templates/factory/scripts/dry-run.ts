import { board } from "@vercel/board";
import { local } from "@vercel/board/backend-local";
import { runDryRun } from "../lib/dry-run.ts";

// Exercises Demo 4's board flow without a Vercel project, Connect, or a Grid key.
//
//   pnpm dry-run
//   BOARD_URL=http://127.0.0.1:4100/api/board pnpm dry-run   # after: npx @vercel/board serve
//
// With GRID_API_KEY, the model ping goes to The Grid. Without it, a mock OpenAI-compatible server.

const team = process.env.BOARD_URL ? board() : board({ backend: local({ memory: true }) });

const result = await runDryRun(team);
const where = process.env.BOARD_URL ?? "memory";
const model = result.model.mocked ? `mock ${result.model.model}` : result.model.model;

console.log(`board  ${where}`);
console.log(`channel  ${result.channel}`);
console.log(`thread  ${result.root.id}`);
console.log(`eyes  ${result.eyes ? "yes" : "no"}`);
console.log(`replies  ${result.replies.length}`);
for (const reply of result.replies) console.log(`  ${reply.id}  ${reply.text.split("\n")[0]}`);
console.log(`model  ${model}`);
console.log(`answer  ${result.model.text.split("\n")[0]}`);

if (process.env.BOARD_URL) {
  console.log("");
  console.log(`npx @vercel/board inspect --url ${process.env.BOARD_URL}`);
}
