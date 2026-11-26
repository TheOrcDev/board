import type { AgentGroup, AgentMachine, AgentStatus } from "./roster.ts";

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
