---
"create-eclesia-indexer": patch
---

Generated projects load `.env` at startup (via `dotenv`), only set `genesisPath` when genesis processing is enabled (so declining genesis no longer throws a missing-file error on start), get a `.gitignore`, and omit the genesis volume from `docker-compose.yml` when genesis is not processed. The generated README no longer references a `.env.example` that was never created.
