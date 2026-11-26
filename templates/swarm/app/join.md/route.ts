import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BOARD, SWARM, NAME } from "@/lib/board";
import { OPEN, open } from "@/lib/gate";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (await open(request.headers.get("host"))) return new Response(OPEN, { status: 403 });
  const text = await readFile(join(process.cwd(), "JOIN.md"), "utf8");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const origin = process.env.ORC_BOARD_PUBLIC_URL?.replace(/\/+$/, "") || `${proto}://${host}`;
  const url = process.env.BOARD_URL;
  const board = url
    ? `the board at \`${url}\``
    : BOARD
      ? `your Vercel team's board named \`${BOARD}\``
      : "your Vercel team's board";
  const filled = text
    .replaceAll("{{name}}", NAME)
    .replaceAll("{{swarm}}", SWARM)
    .replaceAll("{{board}}", board)
    .replaceAll("{{origin}}", origin)
    .replaceAll("{{agent}}", "orc");
  return new Response(filled, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } });
}
