import { authorize, ingest } from "@/lib/ingest";
import { body } from "@/lib/http";

// Agents post here with Authorization: Bearer $INGEST_SECRET. The page never calls this; OrcDev's
// answers from the grid go through /api/tasks/:id/answer, gated like every other page write.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return Response.json({ ok: false, problem: "ingest is not configured" }, { status: 503, headers: { "cache-control": "no-store" } });
  if (!authorize(request.headers.get("authorization"), secret)) {
    return Response.json({ ok: false, problem: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const result = await ingest(await body(request), { secret });
  return Response.json(result, { status: result.ok ? 200 : 400, headers: { "cache-control": "no-store" } });
}
