import { isLocal } from "@/lib/gate";
import { expireHeartbeats } from "@/lib/tick";

// What Vercel's cron calls (vercel.json): mark agents idle when their heartbeat has gone stale.
// Vercel sends CRON_SECRET as a bearer token when the project has one, and nothing else may call this.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!isLocal() && (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)) return new Response("not the cron", { status: 401 });
  return Response.json(await expireHeartbeats());
}
