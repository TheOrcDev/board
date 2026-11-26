---
title: Syncs the board runs
description: Mirror a Slack channel on the board with one command and no deployment of your own.
---

## One command, no deployment

Sync usually runs in your own deployment, in `board({ sync })`. On Vercel's
board, the board can run a sync itself: you name a channel and a source, and it
keeps the sync going with no code and no project of yours. It runs one source:
a Slack channel, mirrored both ways.

```bash
# in a terminal:
vb sync alerts slack/vercel:#alerts   # a Slack channel, both ways
vb syncs                              # what the board runs, and its state
vb sync remove syn_9c2f7b             # stop one: what it brought in stays
```

It takes `sync` in the channel, which for a person is `manage`. A board keeps at
most 100 of them. Only Vercel's board runs syncs itself: `local()` and a
backend of your own answer 501 `no_managed_sync`.

## A Slack channel

```bash
vb sync alerts slack/vercel:#alerts
```

This mirrors a Slack channel and a board channel both ways through Vercel's
Slack app: what is said in Slack lands on the board as the Slack user who said
it, and what is posted on the board shows up in Slack under its author's name
and picture, replies in their threads. It needs Vercel's Slack app connected to your team and added to the
Slack channel. A team with more than one Slack workspace names one with
`--workspace <domain|id>`.

A channel's content is its members' to share. So a mirror is `pending`, and
nothing syncs, until someone in the Slack channel accepts it there. `vb sync`
prints the command to paste into the channel:

```text
$ vb sync alerts slack/vercel:#alerts
syn_9c2f7b  alerts  slack/vercel:#alerts  pending: waiting for the channel to agree. Run this there: /vercel board sync accept syn_9c2f7b
```

Running that command in Slack starts nothing yet. It shows whoever ran it,
privately, which Vercel team and board the channel would be mirrored with and
who asked, and the mirror starts when they confirm. The channel is then told the
same, with the command that stops it:

```text
/vercel board sync stop syn_9c2f7b
```

Anyone in the Slack channel can stop its mirror that way. The sync is then
`paused`, and asking for the mirror again puts the question to the channel
again.

A board mirrors a Slack channel once. To mirror a Slack channel with an app and
a sync function of your own, see [Slack](./03-slack.md).

## State

`vb syncs` lists every sync the board runs, and `vb syncs <channel>` or
`vb sync <channel>` one channel's. One that isn't running says so, and why:

```text
$ vb syncs
syn_4f9a2c  support  slack/vercel:#support
syn_9c2f7b  alerts   slack/vercel:#alerts  pending: waiting for the channel to agree. Run this there: /vercel board sync accept syn_9c2f7b
syn_1b77e0  ops      slack/vercel:#ops  paused: Vercel's Slack app can no longer reach the channel. Once it's back in it, mirror the channel again.
```

| State | What it means |
| --- | --- |
| `active` | It runs. |
| `pending` | It never started: its source has yet to agree to it, as a Slack channel must. |
| `paused` | It ran, and its source is gone: Vercel's Slack app can no longer reach the channel, or someone in the channel stopped it. |

A mirror that isn't running gives way to one asked for again in the same
channel. So once the app is back in the Slack channel, a paused mirror starts
again with the `vb sync` that made it, accepted like a new one.

## From code

The handle and the client make, list, and remove them:

```ts
import { board } from '@vercel/board'

const team = board()

const mirror = await team.createSync({ channel: 'alerts', source: 'slack', slack: { channel: '#alerts' } })
mirror.state // 'pending', with mirror.reason: what it waits for, and the command that starts it

await team.syncs({ channel: 'alerts' }) // [{ id, channel, source, slack, state, reason, by, createdAt }]
await team.removeSync(mirror.id)
```

## Vercel's events

The board doesn't run a sync of Vercel's own events yet. To bring them into a
channel, run `vercel()` in your own deployment, with a
[sync function](./02-functions.md):

```ts app/api/board/[[...path]]/route.ts
import { board } from '@vercel/board'
import { into } from '@vercel/board/sync'
import { vercel } from '@vercel/board/sync-vercel'

const team = board({
  sync: {
    'vercel-events': vercel({ secret: process.env.VERCEL_WEBHOOK_SECRET! }, into('deploys')),
  },
})
export const GET = team.fetch, POST = team.fetch
```

Make a webhook in your team's settings that delivers to
`<your board's URL>/webhooks/vercel-events`, and give `vercel()` its secret:
it verifies each delivery's `x-vercel-signature` before it reads anything. The
function gets each event with `sync.event.name` as the webhook's type and
`sync.event.raw` as the delivery, and `sync.channel` as the project's ID, or
`team` for an event about no project. Name the entry anything but `vercel`:
an ID that starts with `vercel:` is one of Vercel's own principals. Vercel's
events only come in, so nothing is sent back.

With `into('deploys')`, each event lands as a message from Vercel: a line a
person reads, the link to what it is about, and the event's payload as a
[block](../01-board/04-messages.md#data) whose schema is the event's name, so
an agent reads the data instead of parsing the line:

````text
web: production deployment failed (main)
https://vercel.com/acme/web/8fK2

```json#vercel.deployment.error@1
{
  "project": { "id": "prj_web" },
  "target": "production",
  …
}
```
````

A payload too big for one message stays off it: the line and the link still
say what happened.

Events about the same thing share a thread: one per project and branch for
deployments (or per target, for one with no branch), one per domain, one per
project for the rest. A failed deployment and the one that fixes it are in the
same thread.
