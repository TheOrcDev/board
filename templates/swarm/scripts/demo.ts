#!/usr/bin/env node
// Drop a goal on the board through POST /api/ingest, then play a short swarm: a lead splits the
// work, workers claim and log, one blocks for Needs OrcDev, and everything completes after the answer.
// Aim the Next app at `npx @vercel/board serve` with BOARD_URL. This script never talks to the board itself.
import { parseArgs } from "node:util";

const args = parseArgs({
  options: {
    url: { type: "string" },
    secret: { type: "string" },
    local: { type: "boolean", default: false },
    pause: { type: "string", default: "0" },
    hold: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const origin = (args.values.url ?? process.env.ORC_BOARD_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const secret = args.values.secret ?? process.env.ORC_BOARD_SECRET ?? process.env.INGEST_SECRET;
if (!secret) {
  console.error("set ORC_BOARD_SECRET or pass --secret");
  process.exit(2);
}

const pauseMs = Number(args.values.pause ?? 0) || 0;
const hold = Boolean(args.values.hold);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Ok = { ok: true } & Record<string, unknown>;
type Err = { ok: false; problem: string };

async function ingest(body: Record<string, unknown>): Promise<Ok> {
  const headers: Record<string, string> = { authorization: `Bearer ${secret}`, "content-type": "application/json" };
  if (process.env.ORC_BYPASS) headers["x-vercel-protection-bypass"] = process.env.ORC_BYPASS;
  const response = await fetch(`${origin}/api/ingest`, { method: "POST", headers, body: JSON.stringify(body) });
  const json = (await response.json()) as Ok | Err;
  if (!json.ok) {
    console.error(`ingest ${body.action}: ${json.problem}`);
    process.exit(1);
  }
  return json;
}

const hb = (agent: string, group: string, machine: string, status: string, task?: string) =>
  ingest({ action: "heartbeat", agent, group, machine, status, ...(task ? { task } : {}) });

console.log(`demo  ${origin}${args.values.local ? "  (local board via the app's BOARD_URL)" : ""}`);

await hb("lead", "grok", "cloud", "working", "planning");
await hb("xorc", "grok", "cloud", "waiting");
await hb("videorc-main", "codex", "mac", "waiting");
await hb("claude-videorc", "claude", "mac", "waiting");

const goal = "Fix Videorc audio drift on Linux";
const reproduce = await ingest({
  action: "create",
  agent: "lead",
  channel: "swarm/work",
  text: `${goal}: reproduce\n\nCapture 30s of desktop audio on Linux. Post the drift in milliseconds. Do not patch yet.`,
});
const patch = await ingest({
  action: "create",
  agent: "lead",
  channel: "swarm/work",
  text: `${goal}: patch the capture clock\n\nOwn: the Linux capture path. Done when a 30s recording stays within 5ms.`,
});
const review = await ingest({
  action: "create",
  agent: "lead",
  channel: "swarm/work",
  text: `${goal}: review the patch\n\nCheck the Linux path only. Fail if the clock is guessed instead of measured.`,
  needs: [String(patch.id)],
});
console.log(`created  ${reproduce.id}  reproduce`);
console.log(`created  ${patch.id}  patch`);
console.log(`created  ${review.id}  review (waits for patch)`);

await hb("xorc", "grok", "cloud", "working", String(reproduce.id));
await ingest({ action: "claim", agent: "xorc", id: reproduce.id });
await ingest({ action: "progress", agent: "xorc", id: reproduce.id, text: "booted the Linux box. recording 30s of a 440Hz tone." });
await sleep(400);
await ingest({ action: "progress", agent: "xorc", id: reproduce.id, text: "drift is +18ms over 30s at 44.1k." });
await ingest({ action: "complete", agent: "xorc", id: reproduce.id, result: "drift +18ms / 30s at 44.1k on Linux" });
await hb("xorc", "grok", "cloud", "idle");
console.log(`completed  ${reproduce.id}  xorc`);

await hb("videorc-main", "codex", "mac", "working", String(patch.id));
await ingest({ action: "claim", agent: "videorc-main", id: patch.id });
await ingest({ action: "progress", agent: "videorc-main", id: patch.id, text: "read xorc's numbers. looking at the capture clock." });
await ingest({
  action: "block",
  agent: "videorc-main",
  id: patch.id,
  question: "Resample to 48kHz, or stretch the timestamps? I'd resample: the device is 48k and ALSA is lying about 44.1.",
});
await hb("videorc-main", "codex", "mac", "waiting", String(patch.id));
console.log(`blocked  ${patch.id}  waiting on OrcDev`);

if (hold) {
  console.log("holding at Needs OrcDev. answer from the grid, or Ctrl-C");
  for (;;) await sleep(60_000);
}

if (pauseMs > 0) {
  console.log(`pause ${pauseMs}ms for the grid`);
  await sleep(pauseMs);
}

await ingest({ action: "answer", agent: "orcdev", id: patch.id, text: "Resample to 48kHz. Don't stretch." });
console.log(`answered  ${patch.id}`);

await ingest({ action: "claim", agent: "videorc-main", id: patch.id });
await ingest({ action: "progress", agent: "videorc-main", id: patch.id, text: "resampling to 48kHz. verifying a 30s take." });
await ingest({ action: "complete", agent: "videorc-main", id: patch.id, result: "Linux capture resampled to 48kHz, drift under 5ms" });
await hb("videorc-main", "codex", "mac", "idle");
console.log(`completed  ${patch.id}  videorc-main`);

await hb("claude-videorc", "claude", "mac", "working", String(review.id));
await ingest({ action: "claim", agent: "claude-videorc", id: review.id });
await ingest({ action: "progress", agent: "claude-videorc", id: review.id, text: "checked the Linux path. clock is measured, not guessed." });
await ingest({ action: "complete", agent: "claude-videorc", id: review.id, result: "review approved: 48k resample, drift under 5ms" });
await hb("claude-videorc", "claude", "mac", "idle");
await hb("lead", "grok", "cloud", "idle");
console.log(`completed  ${review.id}  claude-videorc`);
console.log("demo  done");
