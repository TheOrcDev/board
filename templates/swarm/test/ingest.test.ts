import assert from "node:assert/strict";
import { test } from "node:test";
import { board as makeBoard, type Board } from "@vercel/board";
import { local } from "@vercel/board/backend-local";
import { authorize, claimToken, ingest } from "../lib/ingest.ts";
import { resetHeartbeats } from "../lib/heartbeat.ts";
import { isProfileName } from "../lib/roster.ts";
import { snapshot } from "../lib/swarm.ts";
import { expireHeartbeats } from "../lib/tick.ts";

const SECRET = "test-ingest-secret-not-for-production";
const fresh = (): Board => makeBoard({ backend: local({ memory: true }) });
const run = (board: Board, body: Record<string, unknown>, now = Date.now()) => ingest(body, { secret: SECRET, board, now });

test("a bearer token is compared in constant time: missing, wrong, and right", () => {
  assert.equal(authorize(null, SECRET), false);
  assert.equal(authorize("Bearer nope", SECRET), false);
  assert.equal(authorize(`Bearer ${SECRET}x`, SECRET), false);
  assert.equal(authorize(`Bearer ${SECRET.slice(0, -1)}`, SECRET), false);
  assert.equal(authorize(`Bearer ${SECRET}`, SECRET), true);
});

test("an agent name must start with a letter and use up to 32 letters, digits, and hyphens", () => {
  assert.equal(isProfileName("orc"), true);
  assert.equal(isProfileName("finance-orc"), true);
  assert.equal(isProfileName("claude-main"), true);
  assert.equal(isProfileName("1orc"), false);
  assert.equal(isProfileName("orc_dev"), false);
  assert.equal(isProfileName("orc.dev"), false);
  assert.equal(isProfileName("a".repeat(33)), false);
  assert.equal(isProfileName("A" + "b".repeat(31)), true);
});

test("ingest refuses a missing action, a bad agent, and never echoes the secret", async () => {
  resetHeartbeats();
  const board = fresh();
  const missing = await run(board, { agent: "orc" });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.problem, /action/);
  const badName = await run(board, { action: "heartbeat", agent: "1orc", group: "grok", machine: "cloud", status: "idle" });
  assert.equal(badName.ok, false);
  if (!badName.ok) assert.match(badName.problem, /profiles start with a letter/);
  assert.equal(JSON.stringify(badName).includes(SECRET), false);
});

test("a heartbeat writes once a minute per agent, and a second one is kept in memory only", async () => {
  resetHeartbeats();
  const board = fresh();
  const t0 = 1_000_000;
  const first = await run(board, { action: "heartbeat", agent: "orc", group: "grok", machine: "cloud", status: "working", task: "fix-audio" }, t0);
  assert.deepEqual(first, { ok: true, throttled: false });
  const again = await run(board, { action: "heartbeat", agent: "orc", group: "grok", machine: "cloud", status: "idle" }, t0 + 5_000);
  assert.deepEqual(again, { ok: true, throttled: true });
  const later = await run(board, { action: "heartbeat", agent: "orc", group: "grok", machine: "cloud", status: "idle" }, t0 + 60_000);
  assert.deepEqual(later, { ok: true, throttled: false });
  const snap = await snapshot(board, "swarm/");
  const tile = snap.agents.find((agent) => agent.id === "orc");
  assert.ok(tile);
  assert.equal(tile!.status, "idle");
  assert.equal(tile!.machine, "cloud");
});

test("create, claim, progress, block, answer, and complete go through ingest on a local board", async () => {
  resetHeartbeats();
  const board = fresh();
  const made = await run(board, { action: "create", agent: "lead", text: "Fix Videorc audio drift on Linux\n\nReproduce, then patch.", channel: "swarm/work" });
  assert.equal(made.ok, true);
  if (!made.ok) return;
  const id = "id" in made ? String(made.id) : "";
  assert.ok(id);

  const claimed = await run(board, { action: "claim", agent: "videorc-main", id });
  assert.equal(claimed.ok, true);

  const progress = await run(board, { action: "progress", agent: "videorc-main", id, text: "reproduced at 44.1k" });
  assert.equal(progress.ok, true);

  const blocked = await run(board, { action: "block", agent: "videorc-main", id, question: "Resample to 48kHz, or stretch timestamps?" });
  assert.equal(blocked.ok, true);

  let snap = await snapshot(board, "swarm/");
  assert.equal(snap.counts.blocked, 1);
  assert.equal(snap.needs.length, 1);
  assert.match(snap.needs[0]!.question, /48kHz/);

  const replied = await run(board, { action: "answer", agent: "orcdev", id, text: "Resample to 48kHz." });
  assert.equal(replied.ok, true);

  const claimedAgain = await run(board, { action: "claim", agent: "videorc-main", id });
  assert.equal(claimedAgain.ok, true);

  const done = await run(board, { action: "complete", agent: "videorc-main", id, result: "resampled to 48kHz" });
  assert.equal(done.ok, true);

  snap = await snapshot(board, "swarm/");
  assert.equal(snap.tasks.find((task) => task.id === id)?.state, "completed");
  assert.equal(snap.counts.blocked, 0);
});

test("a reviewer that needs another task waits until that one completes", async () => {
  resetHeartbeats();
  const board = fresh();
  const work = await run(board, { action: "create", agent: "lead", text: "patch the clock", channel: "swarm/work" });
  assert.ok(work.ok && "id" in work);
  const review = await run(board, { action: "create", agent: "lead", text: "review the clock patch", channel: "swarm/work", needs: [(work as { id: string }).id] });
  assert.ok(review.ok && "id" in review);
  const snap = await snapshot(board, "swarm/");
  assert.equal(snap.tasks.find((task) => task.id === (review as { id: string }).id)?.state, "waiting");
  await run(board, { action: "claim", agent: "xorc", id: (work as { id: string }).id });
  await run(board, { action: "complete", agent: "xorc", id: (work as { id: string }).id, result: "patched" });
  assert.equal((await snapshot(board, "swarm/")).tasks.find((task) => task.id === (review as { id: string }).id)?.state, "ready");
});

test("an unknown agent that heartbeats appears in its group, and a stale one is marked idle", async () => {
  resetHeartbeats();
  const board = fresh();
  const t0 = 5_000_000;
  await run(board, { action: "heartbeat", agent: "codex-session-9", group: "codex", machine: "mac", status: "working" }, t0);
  let snap = await snapshot(board, "swarm/");
  const guest = snap.agents.find((agent) => agent.id === "codex-session-9");
  assert.ok(guest);
  assert.equal(guest!.group, "codex");
  assert.equal(guest!.status, "working");
  const expired = await expireHeartbeats(board, t0 + 4 * 60_000);
  assert.ok(expired.idle.includes("codex-session-9"));
  snap = await snapshot(board, "swarm/");
  assert.equal(snap.agents.find((agent) => agent.id === "codex-session-9")?.status, "idle");
});

test("a snapshot still seeds idle tiles when nobody has heartbeated", async () => {
  resetHeartbeats();
  const snap = await snapshot(fresh(), "swarm/");
  assert.ok(snap.agents.some((agent) => agent.id === "finance-orc" && agent.status === "idle"));
  assert.ok(snap.agents.some((agent) => agent.id === "claude-troll" && agent.group === "claude"));
  assert.ok(snap.agents.some((agent) => agent.id === "codex-hub" && agent.machine === "mac"));
  assert.equal(snap.agents.filter((agent) => agent.group === "grok").length >= 15, true);
});

test("a claim token is 32 bytes in base64url, and the same agent and task always get the same one", () => {
  const a = claimToken(SECRET, "orc", "1");
  const b = claimToken(SECRET, "orc", "1");
  const c = claimToken(SECRET, "dev", "1");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 43);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});
