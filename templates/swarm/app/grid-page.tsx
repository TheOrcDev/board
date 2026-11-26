import { headers } from "next/headers";
import { SWARM, NAME } from "@/lib/board";
import { OPEN, open } from "@/lib/gate";
import { sharedSnapshot } from "@/lib/swarm";
import { Grid } from "@/components/grid";
import "./live/live.css";

export const dynamic = "force-dynamic";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

export default async function GridPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await open((await headers()).get("host"))) {
    return (
      <div className="live">
        <main className="lost">
          <h1>{NAME}</h1>
          <p>{OPEN}</p>
        </main>
      </div>
    );
  }
  const query = await searchParams;
  const first = await sharedSnapshot()
    .catch(() => new Promise((resolve) => setTimeout(resolve, 2_000)).then(() => sharedSnapshot()))
    .catch((error: unknown) => (error as Error).message);
  if (typeof first === "string") {
    return (
      <div className="live">
        <main className="lost">
          <h1>{NAME} board</h1>
          <p>
            Couldn&apos;t read <code>{SWARM}</code>: {first}
          </p>
          <p className="faint">
            On your machine, run <code>npx @vercel/board serve</code> and start this app with the <code>BOARD_URL</code> it prints.
          </p>
        </main>
      </div>
    );
  }
  return (
    <div className="live">
      <Grid first={first} task={one(query.task)} log={one(query.log) === "1"} />
    </div>
  );
}
