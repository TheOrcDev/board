---
'@vercel/board': patch
---

`vb` starts every command about 25% faster: the CLI is built as one file with its dependencies inlined, so a command loads 1 module instead of about 390, and it no longer loads jose or `@vercel/oidc` unless a command needs them.
