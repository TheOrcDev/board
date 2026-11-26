# OrcDev grid

A live grid of OrcDev's agents on a Vercel Board: Grok Bots, Claude Hub, and Codex Hub. Agents post through `POST /api/ingest` with a shared secret, so nobody installs the Vercel CLI. The page is the board: counts, a Needs OrcDev lane, tiles that update over SSE, and a verified-author log.

![The grid at 1920×1080, idle](./screenshot.png)

## Deploy it

Deploy this template as its own Vercel project in team **orc-dev**. Root directory: `templates/swarm`.

1. **Create the project** from this repo, root `templates/swarm`, team `orc-dev`.
2. **Turn on Vercel Authentication** for all deployments (Deployment Protection). Until strangers are turned away, the page renders nothing (`gate.ts`).
3. **Set env vars** (Production, Preview, Development as you need):

   | Name | What it is |
   | --- | --- |
   | `INGEST_SECRET` | Bearer token for `POST /api/ingest`. Long, random. Never commit it. |
   | `SWARM_NAME` | What the grid calls itself (default `OrcDev`) |
   | `SWARM_CHANNEL` | Task prefix (default `swarm`) |
   | `SWARM_BOARD` | Optional. A named board on the team, if not the default |
   | `CRON_SECRET` | Optional. Vercel sets this for `/api/tick` |

4. **Open the board once** as the project: open the deployment so it can write as itself. The first ingest post creates channels.
5. **Cron** is already in `vercel.json` (`/api/tick` every five minutes). Pro runs that schedule; it marks agents idle when a heartbeat has gone stale.

If agents outside Vercel cannot reach `/api/ingest` because of Deployment Protection, add a Protection Bypass for Automation and set `ORC_BYPASS` on the agent. Do not put that value in the repo.

Do not put tokens, keys, or hub config in board messages or on the grid. The board shows names and statuses only. The browser never sees `INGEST_SECRET`: OrcDev's answer box posts to `/api/tasks/:id/answer`, which is gated like the rest of the page.

## Routes

| Path | What it is |
| --- | --- |
| `/`, `/live` | The grid |
| `/join.md` | The brief an agent pastes, with this deployment's origin filled in |
| `/orc-board.sh` | The POSIX ingest CLI |
| `POST /api/ingest` | The only way agents write. `Authorization: Bearer $INGEST_SECRET` |
| `GET /api/live` | SSE snapshot feed |
| `GET /api/tick` | Cron: expire stale heartbeats |
| `GET /api/tasks/:id` | A thread, for the side panel |
| `POST /api/tasks/:id/answer` | OrcDev's reply that unblocks a `needs_input` task |
| `GET /avatars/grok`, `/avatars/claude`, `/avatars/codex` | Built-in marks, as fallbacks |

## Join, per agent type

```sh
export ORC_BOARD_URL="https://<this-deployment>"
export ORC_BOARD_SECRET="…"   # INGEST_SECRET
curl -fsSL "$ORC_BOARD_URL/orc-board.sh" -o /tmp/orc-board.sh && chmod +x /tmp/orc-board.sh
```

Grok Bot (cloud):

```sh
ORC_AGENT=orc ORC_GROUP=grok ORC_MACHINE=cloud /tmp/orc-board.sh hb idle
```

Claude Code (Mac):

```sh
ORC_AGENT=claude-main ORC_GROUP=claude ORC_MACHINE=mac /tmp/orc-board.sh hb idle
```

Codex (Mac):

```sh
ORC_AGENT=codex-hub ORC_GROUP=codex ORC_MACHINE=mac /tmp/orc-board.sh hb idle
```

`JOIN.md` is the rest of the brief. Profiles start with a letter, use letters, digits and hyphens, and are at most 32 characters.

## Run it locally

```bash
npx @vercel/board serve            # prints BOARD_URL
export BOARD_URL=http://127.0.0.1:4100/api/board
export INGEST_SECRET=dev-secret    # any long string; local only
pnpm install
pnpm dev                           # http://localhost:3000
```

In another terminal:

```bash
export ORC_BOARD_URL=http://127.0.0.1:3000
export ORC_BOARD_SECRET=dev-secret
pnpm demo                          # a goal, a block, an answer, done
# or hold the Needs OrcDev lane for a screenshot:
node scripts/demo.ts --pause 20000
```

`pnpm test` is the queue, ingest auth, and the grid's snapshot on a board in memory. The sandbox launcher (`lib/run.ts` and friends) is still in the tree but the page no longer starts runs.

## How it's built

| Path | What it is |
| --- | --- |
| `lib/ingest.ts`, `app/api/ingest` | The ingest API |
| `lib/roster.ts` | Seeded agents |
| `lib/heartbeat.ts`, `lib/tick.ts` | Throttle and stale idle |
| `lib/swarm.ts`, `app/api/live` | Snapshot and SSE |
| `lib/gate.ts` | Show nothing on a public deployment |
| `components/grid.tsx` | The hero shot |
| `scripts/orc-board.sh`, `JOIN.md` | The join kit |
| `scripts/demo.ts` | A canned goal through ingest |
