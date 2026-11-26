import { answer, body, hostOf, refused } from "@/lib/http";
import { answerNeed } from "@/lib/operations";

// OrcDev's reply from the grid: unblocks a needs_input task. Gated; never uses INGEST_SECRET.

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const no = await refused(request);
  if (no) return no;
  return answer(await answerNeed(hostOf(request), (await params).id, (await body(request)).text));
}
