# Filming Demo 4: Factory on Orcanva

Runbook for "I Gave My AI Agents Their Own Slack", Demo 4 and the Grid sponsor
segment that plays immediately before it. The video must be live by 30 Nov 2026.
Michael at Yard reviews the Grid cut first.

This file is the shot list and the commands. Do not open the GitHub issue until
you are rolling, and do not create Vercel projects or Grid keys from a script.

## What this copy already has

- `TheOrcDev/orcanva` (branch `main`) mapped to `project-<name>/orcanva` in
  `app/api/board/[[...path]]/channels.ts`.
- `agent/agent.ts` already on The Grid: `text-prime` at
  `https://api.thegrid.ai/v1`, key from `GRID_API_KEY`.
- Context window `196_608`, the floor for Text Prime, Code Prime, and Agent
  Prime on [current instruments](https://thegrid.ai/docs/instrument-specifications/current-instruments).
- `GRID_MODEL=agent-prime` (or changing `"text-prime"` to `"agent-prime"`) if
  tool calls struggle. One word.
- A local dry-run that does not need a Grid key or Connect.

The committed `agent.ts` is the **after**. The sponsor segment starts on the
hard-coded Anthropic line. See [On camera: The Grid](#on-camera-the-grid).

## One-time setup

Placeholders: `<your-team>` is the Vercel team slug, `<project>` is this
factory's Vercel project name (`factory` if you keep the default). Connectors
and board channels follow that name: `github/factory`, `project-factory`,
`project-factory/orcanva`.

```bash
cd templates/factory
# eve 0.84.1 needs Node 24. On Vercel: Settings → General → Node.js Version 24.x
node -v   # v24.x
pnpm install
cp .env.example .env.local

vercel login
vercel link --yes --project factory --scope <your-team>
```

If you linked from the monorepo root instead, set **Root Directory** to
`templates/factory` in Settings → General.

```bash
# Board: open it once so the team has one.
npx @vercel/board inspect --scope <your-team>
```

Dashboard, same project:

1. Settings → Deployment Protection → Vercel Authentication on for **all**
   deployments. Until that is on, the launcher shows only how to protect it.
2. Settings → Git: production branch `main`. Root Directory `templates/factory`
   when the git repo is this board checkout.

```bash
vercel connect create github --name factory --triggers --trigger-project factory --trigger-path /api/board/webhooks/github --scope <your-team>
```

Install that GitHub app on:

- `TheOrcDev/orcanva`
- this factory's own git repo (whatever `vercel link` pointed at)

Grant **contents:write** on both. The launcher's GitHub step says when the app
can write to the factory repo.

Slack is optional for this demo. GitHub issue → board thread → PR is enough.
To add Slack later:

```bash
vercel connect create slack --name factory --triggers --trigger-project factory --trigger-path /api/board/webhooks/slack --scope <your-team>
```

Then uncomment `[slackChannel("-orcanva")]: channel("orcanva")` in `channels.ts`
and invite the app to `#factory-orcanva`.

### The Grid key

There is no key in this repo. Sign up at [thegrid.ai](https://thegrid.ai).
Create a Consumption API key under Settings → API Keys, also at
[app.thegrid.ai/profile/api-keys](https://app.thegrid.ai/profile/api-keys).
They show it once.

Send Michael (`michael@tryyard.com`) the account email so he can set up
permissions. New signups get free credits; confirm the amount on the signup
page before saying a number on camera. Phone verification is required. Credits
expire after 14 days.

```bash
vercel env add GRID_API_KEY
# Paste the key. Add it for Production, Preview, and Development.
# Do not print it, commit it, or show the full value on camera.

# Optional. Default is already text-prime.
# vercel env add GRID_MODEL
# text-prime

vercel env pull
```

Redeploy after the env vars land. The launcher's Vercel step is done when
`GRID_API_KEY` is set, the board is reachable, and Deployment Protection is on.

## Dry-run (before the key exists)

This is the rehearsal. It posts a fake Orcanva issue on a local board, reacts
with eyes, replies with a reproduction and a PR link, and hits an
OpenAI-compatible `/chat/completions`. With `GRID_API_KEY` that request goes to
The Grid. Without it, a mock server on localhost.

```bash
cd templates/factory
pnpm test          # includes the dry-run assertions
pnpm dry-run
```

To watch the same thread in the inspector:

```bash
npx @vercel/board serve
BOARD_URL=http://127.0.0.1:4100/api/board pnpm dry-run
npx @vercel/board inspect --url http://127.0.0.1:4100/api/board
```

Open `project-factory/orcanva`. You should see the issue, an eyes reaction, a
reproduction reply, and a PR-link reply. That is the shape Demo 4 has to show,
minus a real GitHub issue and a real sandbox.

`pnpm dry-run` does **not** clone Orcanva, open a GitHub issue, or call eve.
Those need Connect, a Grid key, and the deployed factory.

## GitHub issue to open on camera

Do not open this until you are rolling. It is small, visible, and on-brand:
YouTube preview, one file.

**Repo:** [TheOrcDev/orcanva](https://github.com/TheOrcDev/orcanva)  
**Title:** Duration badge on YouTube preview vanishes on light thumbnails

**Body:**

```text
Open a YouTube thumbnail that's mostly white or yellow, then open YouTube preview.

The duration badge in the bottom-right of the thumbnail is hard to read. YouTube's own badge is a dark pill with white text, so it stays readable on any thumbnail.

Expected: a dark translucent pill (like YouTube) so the duration stays readable on a light thumbnail.

Steps:
1. Studio → a light or yellow thumbnail
2. Open YouTube preview
3. Look at the duration in the corner of the card
```

Why this one: it reproduces in the sandbox without a database, the before/after
is a screenshot, and the change lives in
`components/youtube-preview/duration-badge.tsx`. If that file already has a
dark pill when you film, pick another tiny visual bug in Studio and keep the
same flow.

Skip the launcher's "make the README yours" first task until after the take.
That task opens a PR against the factory repo, not Orcanva.

## On camera: The Grid

Voiceover is Option B in the Notion script, word for word. 60–90 seconds.
Fill it as an on-screen build. No savings claims, no "cheapest", no naming
other providers.

The committed `agent/agent.ts` is already the Grid version. For Beat 1, put
the old line back, then apply this file's version.

1. Open `templates/factory/agent/agent.ts`.
2. Beat 1: hold on `model: "anthropic/claude-opus-5.5"` while you ask how many
   places have a model name written in.
3. Beat 2: wire `createOpenAICompatible`, then the three values:
   - `baseURL: "https://api.thegrid.ai/v1"`
   - `apiKey: process.env.GRID_API_KEY`
   - `model: grid("text-prime")`  
   On camera you can type `grid("text-prime")`. The committed line is
   `grid(process.env.GRID_MODEL ?? "text-prime")` so a rehearsal can switch
   with `GRID_MODEL=agent-prime` and no extra edit. Save.
4. Trigger a real request: open the Orcanva issue below, or bump it. The
   factory agent should 👀 the thread.
5. Beat 3: cut back to the board thread, then open
   [app.thegrid.ai/dashboard](https://app.thegrid.ai/dashboard) and
   [app.thegrid.ai/usage](https://app.thegrid.ai/usage). Show which model
   served the request and what it cost. Confirm those two labels before you
   say "model" vs "supplier" on camera. Do not read a savings percentage.
6. Beat 4: end on thegrid.ai, "Alright, let's get back to it," and stay on
   this Factory run. Demo 4 is now on The Grid. That is the point.

If eve's hosted build cannot resolve `@ai-sdk/openai-compatible`,
`defineAgent` already lists it in `build.externalDependencies`.

If requests 404, try `https://api.thegrid.ai` without `/v1`. Do not add
`/chat/completions` to the base URL, and do not use a trailing slash. curl
needs `-L` because of a 307; the AI SDK follows it.

Paid promotion: Yes on the YouTube upload. thegrid.ai in the description and
a pinned comment. Use Michael's tracking link when it arrives.

## On camera: Demo 4

1. Factory launcher, running, with Orcanva in the repo list.
2. Open the GitHub issue on `TheOrcDev/orcanva`.
3. Board thread in `project-factory/orcanva` (or `project-<name>/orcanva`):
   the issue lands, the agent reacts with 👀.
4. Agent reproduces in its sandbox, then replies with what it found.
5. Agent opens a PR on Orcanva and replies with the link in the same thread.
6. Optional: it stays with the PR (check-ins) until you say merge or close.

Watch it:

```bash
npx @vercel/board inspect --scope <your-team>
# Production is the team's default board. A preview or `pnpm dev` is factory-dev:
npx @vercel/board inspect --scope <your-team> --name factory-dev
```

Or **Open the board** on the deployment (`/board`).

## What should be on screen

| Beat | Shot |
| --- | --- |
| Sponsor 1 | `agent/agent.ts`, cursor on `model: "anthropic/claude-opus-5.5"` |
| Sponsor 2 | The three-value swap to Grid |
| Sponsor 3 | Board thread still moving, then Grid dashboard usage / trade log |
| Sponsor 4 | thegrid.ai, then straight into Factory |
| Demo 4 | Orcanva GitHub issue → board thread with 👀 → PR link in the same thread |

## If tool calls fail

One word, in this order:

1. `GRID_MODEL=agent-prime` in the project env, redeploy.
2. Or change `"text-prime"` to `"agent-prime"` in `agent/agent.ts`.

Do not say a specific model sits behind either instrument.

## What this dry-run cannot prove

- A real Grid request, until `GRID_API_KEY` exists.
- GitHub sync, until the Connect GitHub connector and app install exist.
- eve + sandbox clone of Orcanva, until the factory is deployed with OIDC,
  Deployment Protection, and the GitHub token from Connect.
- The Grid dashboard labels for served model and request cost.
- Slack, which this demo does not need.
