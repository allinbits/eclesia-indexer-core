---
"create-eclesia-indexer": patch
---

- The CLI starts again: the bin shim imported `dist/index.js`, but tsdown 0.16 emits `dist/index.mjs`, so `npx create-eclesia-indexer` failed with `ERR_MODULE_NOT_FOUND`. The `exports`, `module` and `types` fields point at the emitted files as well.
- The generated `docker-compose.yml` no longer binds host port 8888 twice; Hasura is mapped to 8080, the port it listens on.
