import { BoardError, type Board } from "@vercel/board";
import { team } from "./board.ts";
import { heartbeatDue, markHeartbeatWritten, rememberHeartbeat, staleHeartbeats } from "./heartbeat.ts";
import { writeHeartbeat } from "./ingest.ts";

/**
 * Mark agents whose heartbeat has gone stale as idle, writing at most once a minute per agent.
 * Called from the cron (`/api/tick`) so the grid doesn't show a crashed agent as working.
 */
export async function expireHeartbeats(board: Board = team(), now = Date.now()): Promise<{ idle: string[] }> {
  const idle: string[] = [];
  for (const hb of staleHeartbeats(now)) {
    rememberHeartbeat({ ...hb, status: "idle", task: null, at: now });
    idle.push(hb.agent);
    if (!heartbeatDue(hb.agent, now)) continue;
    try {
      await writeHeartbeat(board, hb.agent, { group: hb.group, machine: hb.machine, status: "idle", task: null });
      markHeartbeatWritten(hb.agent, now);
    } catch (error) {
      if (error instanceof BoardError && error.status === 429) break;
    }
  }
  return { idle };
}
