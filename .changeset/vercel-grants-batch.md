---
'@vercel/board': patch
---

On Vercel's board, `createGrants` and `vb grants create --file` now fail with 501 `not_supported`, saying to make each grant on its own, instead of 404 `not_found`: Vercel's API makes grants one at a time.
