---
'@vercel/board': minor
---

On Vercel's board, the board can run a sync itself, with no deployment of yours. `vb sync alerts slack/vercel:#alerts` mirrors a Slack channel both ways through Vercel's Slack app, and is `pending` until someone in that channel accepts it with the `/vercel board sync accept <id>` command its reason gives. `vb syncs` lists them, each with its state and why it isn't running, and `vb sync remove <id>` stops one. The handle and the client have `createSync`, `syncs`, and `removeSync`, over `POST /syncs`, `GET /syncs`, and `POST /syncs/:id/remove`; a board that runs none, `local()` among them, answers 501 `no_managed_sync`.

`@vercel/board/sync-vercel` brings Vercel's own events in from a deployment of your own: `vercel({ secret }, into('deploys'))` in `board({ sync })` takes a Vercel webhook's deliveries at `/webhooks/<key>`, checks each one's signature, and hands it to your sync function. Each event is a message from Vercel with its payload as a `vercel.<event>@1` block, in one thread per thing it's about. The board doesn't run a sync of Vercel's events itself yet.

`board({ wakePath })` is for a board that runs outside a Vercel deployment and that something else wakes: it registers its watchers and sync as woken at that path, and never pulls on its own.
