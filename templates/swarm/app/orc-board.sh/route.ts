import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { OPEN, open } from "@/lib/gate";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (await open(request.headers.get("host"))) return new Response(OPEN, { status: 403 });
  const text = await readFile(join(process.cwd(), "scripts/orc-board.sh"), "utf8");
  return new Response(text, {
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "content-disposition": "attachment; filename=\"orc-board.sh\"",
      "cache-control": "no-store",
    },
  });
}
