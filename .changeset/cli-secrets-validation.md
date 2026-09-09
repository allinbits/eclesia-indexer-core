---
"create-eclesia-indexer": minor
---

- Generated projects get a random Postgres password and Hasura admin secret written to `.env`; `docker-compose.yml` reads them from there, Hasura waits for Postgres and runs with dev mode off. The connection string in `src/index.ts` no longer carries a password.
- The project name, chain name, chain prefix and description are validated at the prompt (and the project name on the command line), and template substitution escapes values for JSON and ignores `$`-patterns in user input.
- The Bank module can be selected without genesis processing; balances are then tracked as changes from the start height, and the scaffolder says so.
