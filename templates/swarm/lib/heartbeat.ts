import { isProfileName, parseGroup, parseMachine, parseStatus, type AgentGroup, type AgentMachine, type AgentStatus } from "./roster.ts";

/** Same prefix as `AGENTS` in board.ts: heartbeat threads live at `agents/<name>`. */
const AGENTS_PREFIX = "agents/";

/** One board write per agent per minute: Vercel's board shares about 300 writes a minute with every profile. */
export const HEARTBEAT_THROTTLE_MS = 60_000;

/** A heartbeat older than this is idle: the cron marks it, and the grid shows it dim. */
export const HEARTBEAT_STALE_MS = 3 * 60_000;

export type Heartbeat = {
  agent: string;
  group: AgentGroup;
  machine: AgentMachine;
  status: AgentStatus;
  task: string | null;
  avatar: string | null;
  /** When this status was last received, even if the board write was throttled. */
  at: number;
  /** When this agent last wrote to `agents/<name>`. */
  writtenAt: number;
};

const store = new Map<string, Heartbeat>();

export const allHeartbeats = (): Heartbeat[] => [...store.values()];

export const heartbeatOf = (agent: string): Heartbeat | undefined => store.get(agent);

export function rememberHeartbeat(next: Omit<Heartbeat, "writtenAt"> & { writtenAt?: number }): Heartbeat {
  const prev = store.get(next.agent);
  const saved: Heartbeat = {
    ...next,
    writtenAt: next.writtenAt ?? prev?.writtenAt ?? 0,
  };
  store.set(next.agent, saved);
  return saved;
}

export function markHeartbeatWritten(agent: string, at: number): void {
  const prev = store.get(agent);
  if (prev) prev.writtenAt = at;
}

/** Whether a board write for this agent is due: none yet, or the last one is older than a minute. */
export function heartbeatDue(agent: string, now: number): boolean {
  const prev = store.get(agent);
  return !prev || now - prev.writtenAt >= HEARTBEAT_THROTTLE_MS;
}

/** Agents whose last status is older than `HEARTBEAT_STALE_MS` and not already idle. */
export function staleHeartbeats(now: number): Heartbeat[] {
  const stale: Heartbeat[] = [];
  for (const hb of store.values()) {
    if (hb.status === "idle") continue;
    if (now - hb.at < HEARTBEAT_STALE_MS) continue;
    stale.push(hb);
  }
  return stale;
}

/** Tests reset the in-memory roster of live statuses. */
export function resetHeartbeats(): void {
  store.clear();
}

type BoardHeartbeat = {
  channel: string;
  labels: Record<string, string>;
  createdAt: string;
  editedAt?: string | null;
  version?: number;
  by?: { profile?: string | null };
};

const agentOf = (message: BoardHeartbeat): string | null => {
  if (message.channel.startsWith(AGENTS_PREFIX)) {
    const id = message.channel.slice(AGENTS_PREFIX.length).split("/")[0] ?? "";
    if (isProfileName(id)) return id.toLowerCase();
  }
  const profile = message.by?.profile?.trim();
  if (profile && isProfileName(profile)) return profile.toLowerCase();
  return null;
};

/**
 * Fill any agent the process has not seen yet from the board's `agents/<name>` heartbeat labels.
 * Live in-memory status wins: a throttled heartbeat this instance took is newer than the last write.
 */
export function restoreHeartbeats(messages: Iterable<BoardHeartbeat>): void {
  const latest = new Map<string, { at: number; version: number; group: AgentGroup; machine: AgentMachine; status: AgentStatus; task: string | null }>();
  for (const message of messages) {
    if (message.labels.kind !== "heartbeat") continue;
    const agent = agentOf(message);
    const group = parseGroup(message.labels.group);
    const machine = parseMachine(message.labels.machine);
    const status = parseStatus(message.labels.status);
    if (!agent || !group || !machine || !status) continue;
    const at = Date.parse(message.editedAt || message.createdAt);
    if (!Number.isFinite(at)) continue;
    const version = message.version ?? 0;
    const prev = latest.get(agent);
    if (prev && (version < prev.version || (version === prev.version && at <= prev.at))) continue;
    const task = message.labels.task?.trim() ? message.labels.task.trim().slice(0, 200) : null;
    latest.set(agent, { at, version, group, machine, status, task });
  }
  for (const [agent, hb] of latest) {
    if (store.has(agent)) continue;
    rememberHeartbeat({ agent, group: hb.group, machine: hb.machine, status: hb.status, task: hb.task, avatar: null, at: hb.at, writtenAt: hb.at });
  }
}
