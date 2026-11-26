import { createHmac, timingSafeEqual } from "node:crypto";
import { BoardError, type Board, type ClaimedTask } from "@vercel/board";
import { AGENTS, SWARM, agentChannel, team } from "./board.ts";
import { heartbeatDue, markHeartbeatWritten, rememberHeartbeat } from "./heartbeat.ts";
import { isProfileName, parseGroup, parseMachine, parseStatus } from "./roster.ts";

/** How long a claim asks for: Vercel's board gives 5 minutes at most. */
export const LEASE_S = 300;

const TEXT_MAX = 10_000;
const NOTE_MAX = 1_000;

export type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; problem: string };

const ok = <T extends object>(extra: T): { ok: true } & T => ({ ok: true, ...extra });
const bad = (problem: string): { ok: false; problem: string } => ({ ok: false, problem });

const ACTIONS = ["heartbeat", "post", "create", "claim", "renew", "progress", "block", "answer", "complete", "fail"] as const;
export type IngestAction = (typeof ACTIONS)[number];

export type IngestContext = {
  secret: string;
  now?: number;
  /** Tests pass a board. The route uses the deployment's. */
  board?: Board;
};

/**
 * Compare the request's bearer token to `INGEST_SECRET` in constant time.
 * Never log `secret` or `authorization`.
 */
export function authorize(authorization: string | null | undefined, secret: string): boolean {
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(authorization ?? "");
  if (got.length !== want.length) {
    timingSafeEqual(want, want);
    return false;
  }
  return timingSafeEqual(got, want);
}

const textOf = (value: unknown, max = TEXT_MAX) => (typeof value === "string" ? value.trim().slice(0, max) : "");

const idOf = (value: unknown) => (typeof value === "string" && /^[\w.:-]{1,128}$/.test(value) ? value : null);

function needsOf(value: unknown): string[] | { problem: string } {
  if (value === undefined || value === null || value === "") return [];
  const list = Array.isArray(value) ? value : [value];
  const ids: string[] = [];
  for (const item of list) {
    const id = idOf(item);
    if (!id) return { problem: "needs: each dependency is a task id" };
    ids.push(id);
  }
  return ids;
}

function agentOf(body: Record<string, unknown>): string | { problem: string } {
  const raw = typeof body.agent === "string" ? body.agent.trim() : "";
  if (!raw) return { problem: "agent is required" };
  if (!isProfileName(raw)) return { problem: "agent: profiles start with a letter and use up to 32 letters, numbers, and hyphens" };
  return raw.toLowerCase();
}

function asAgent(board: Board, agent: string, avatar?: string | null) {
  if (avatar && /^https:\/\//i.test(avatar)) return board.as({ name: agent, avatar });
  return board.as(agent);
}

/** 32 bytes, base64url (43 chars): the same agent and task always get the same claim token. */
export function claimToken(secret: string, agent: string, task: string): string {
  return createHmac("sha256", secret).update(`claim:${agent}:${task}`).digest("base64url");
}

async function held(board: Board, secret: string, agent: string, id: string): Promise<ClaimedTask> {
  return asAgent(board, agent).tasks.claim(id, { lease: LEASE_S, token: claimToken(secret, agent, id) });
}

function fromBoard(error: unknown): { ok: false; problem: string } {
  if (error instanceof BoardError) return bad(error.message);
  return bad(error instanceof Error ? error.message : String(error));
}

const codeOf = (error: unknown) => (error instanceof BoardError ? error.code : "");

async function heartbeat(board: Board, body: Record<string, unknown>, agent: string, now: number): Promise<Result<{ throttled: boolean }>> {
  const group = parseGroup(body.group);
  const machine = parseMachine(body.machine);
  const status = parseStatus(body.status);
  if (!group) return bad("group must be grok, claude, or codex");
  if (!machine) return bad("machine must be mac, ogre, or cloud");
  if (!status) return bad("status must be working, waiting, blocked, idle, or rate-limited");
  const task = typeof body.task === "string" && body.task.trim() ? body.task.trim().slice(0, 200) : null;
  const avatar = typeof body.avatar === "string" && /^https:\/\//i.test(body.avatar) ? body.avatar.trim().slice(0, 500) : null;
  const due = heartbeatDue(agent, now);
  rememberHeartbeat({ agent, group, machine, status, task, avatar, at: now });
  if (!due) return ok({ throttled: true });
  await writeHeartbeat(board, agent, { group, machine, status, task, avatar });
  markHeartbeatWritten(agent, now);
  return ok({ throttled: false });
}

/** One thread per agent (`id: hb-<name>`): the first write creates it, later ones edit it. */
export async function writeHeartbeat(
  board: Board,
  agent: string,
  hb: { group: string; machine: string; status: string; task: string | null; avatar?: string | null },
): Promise<void> {
  const labels: Record<string, string> = { kind: "heartbeat", group: hb.group, machine: hb.machine, status: hb.status };
  if (hb.task) labels.task = hb.task;
  const line = [hb.status, hb.task].filter(Boolean).join(" · ") || hb.status;
  const handle = asAgent(board, agent, hb.avatar);
  const posted = await handle.post(agentChannel(agent), { text: line, labels, id: `hb-${agent}` });
  if (posted.text !== line) await handle.edit(posted.id, line);
  const same =
    posted.labels.kind === "heartbeat" &&
    posted.labels.group === hb.group &&
    posted.labels.machine === hb.machine &&
    posted.labels.status === hb.status &&
    (posted.labels.task ?? "") === (hb.task ?? "");
  if (!same) await handle.label(posted.id, { set: labels, unset: hb.task ? [] : ["task"] });
}

async function post(board: Board, body: Record<string, unknown>, agent: string): Promise<Result<{ id: string }>> {
  const text = textOf(body.text);
  if (!text) return bad("text is required");
  const thread = idOf(body.thread);
  const channel = typeof body.channel === "string" ? body.channel.trim().replace(/^\/+|\/+$/g, "") : "";
  if (thread) {
    const message = await asAgent(board, agent).reply(thread, text);
    return ok({ id: message.id });
  }
  if (!channel) return bad("channel or thread is required");
  const message = await asAgent(board, agent).post(channel, text);
  return ok({ id: message.id });
}

async function create(board: Board, body: Record<string, unknown>, agent: string): Promise<Result<{ id: string }>> {
  const text = textOf(body.text);
  if (!text) return bad("text is required");
  const needs = needsOf(body.needs);
  if ("problem" in needs) return bad(needs.problem);
  const channel = typeof body.channel === "string" && body.channel.trim() ? body.channel.trim().replace(/\/+$/, "") : `${SWARM}work`;
  const { task } = await asAgent(board, agent).tasks.create(channel, { text, ...(needs.length ? { needs } : {}) });
  return ok({ id: task.id });
}

async function claimNext(board: Board, secret: string, agent: string): Promise<Result<{ id: string; title: string } | { id: null }>> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { tasks } = await board.tasks.list({ channel: SWARM, state: "ready", limit: 8 });
    const next = tasks[attempt];
    if (!next) return ok({ id: null });
    try {
      const claim = await held(board, secret, agent, next.message.id);
      return ok({ id: claim.task.id, title: claim.task.text.split("\n", 1)[0] || "" });
    } catch (error) {
      if (codeOf(error) === "task_claimed") continue;
      return fromBoard(error);
    }
  }
  return ok({ id: null });
}

async function claim(board: Board, body: Record<string, unknown>, agent: string, secret: string): Promise<Result<{ id: string | null; title?: string }>> {
  const id = idOf(body.id) ?? idOf(body.task);
  if (!id) return claimNext(board, secret, agent);
  try {
    const taken = await held(board, secret, agent, id);
    return ok({ id: taken.task.id, title: taken.task.text.split("\n", 1)[0] || "" });
  } catch (error) {
    return fromBoard(error);
  }
}

async function withClaim(
  board: Board,
  secret: string,
  agent: string,
  body: Record<string, unknown>,
  run: (claim: ClaimedTask) => Promise<Result>,
): Promise<Result> {
  const id = idOf(body.id) ?? idOf(body.task);
  if (!id) return bad("id is required");
  try {
    return await run(await held(board, secret, agent, id));
  } catch (error) {
    return fromBoard(error);
  }
}

/**
 * Run one ingest action as `agent` on the deployment's board.
 * The caller must already have checked the bearer token.
 */
export async function ingest(body: Record<string, unknown>, ctx: IngestContext): Promise<Result> {
  const action = typeof body.action === "string" ? body.action : "";
  if (!(ACTIONS as readonly string[]).includes(action)) return bad(`action must be ${ACTIONS.join(", ")}`);
  const agent = agentOf(body);
  if (typeof agent !== "string") return bad(agent.problem);
  const board = ctx.board ?? team();
  const secret = ctx.secret;
  const now = ctx.now ?? Date.now();
  try {
    switch (action as IngestAction) {
      case "heartbeat":
        return await heartbeat(board, body, agent, now);
      case "post":
        return await post(board, body, agent);
      case "create":
        return await create(board, body, agent);
      case "claim":
        return await claim(board, body, agent, secret);
      case "renew":
        return await withClaim(board, secret, agent, body, async (taken) => {
          const next = await taken.renew(LEASE_S);
          return ok({ id: next.task.id, until: next.until });
        });
      case "progress": {
        const text = textOf(body.text);
        if (!text) return bad("text is required");
        const id = idOf(body.id) ?? idOf(body.task);
        if (!id) return bad("id is required");
        const message = await asAgent(board, agent).reply(id, text.startsWith("[") ? text : `[progress] ${text}`);
        return ok({ id: message.id });
      }
      case "block": {
        const question = textOf(body.question ?? body.text ?? body.reason, NOTE_MAX);
        if (!question) return bad("question is required");
        return await withClaim(board, secret, agent, body, async (taken) => {
          await taken.block(question, { kind: "needs_input" });
          return ok({ id: taken.task.id });
        });
      }
      case "answer": {
        const text = textOf(body.text);
        if (!text) return bad("text is required");
        const id = idOf(body.id) ?? idOf(body.task);
        if (!id) return bad("id is required");
        return await answerTask(board, id, text, agent);
      }
      case "complete":
        return await withClaim(board, secret, agent, body, async (taken) => {
          const result = textOf(body.result ?? body.text, NOTE_MAX) || "done";
          await taken.complete(result);
          return ok({ id: taken.task.id });
        });
      case "fail": {
        const reason = textOf(body.reason ?? body.text, NOTE_MAX);
        if (!reason) return bad("reason is required");
        return await withClaim(board, secret, agent, body, async (taken) => {
          await taken.fail(reason);
          return ok({ id: taken.task.id });
        });
      }
    }
  } catch (error) {
    return fromBoard(error);
  }
}

/**
 * Reply in a blocked task and unblock it. The deployment owns tasks its profiles made, so unblock
 * runs as the project, not the agent. The browser's answer box uses this, never INGEST_SECRET.
 */
export async function answerTask(board: Board, id: string, text: string, as = "orcdev"): Promise<Result<{ id: string }>> {
  const { message } = await board.thread(id);
  if (!message.task) return bad(`${id} isn't a task`);
  if (!message.channel.startsWith(SWARM) && !message.channel.startsWith(AGENTS)) return bad(`${id} isn't on this board's swarm`);
  await board.as(as).reply(id, text);
  if (message.task.state === "blocked") await board.tasks.unblock(id);
  return ok({ id });
}
