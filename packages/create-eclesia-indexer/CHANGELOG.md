# create-eclesia-indexer

## 2.16.2

## 2.16.1

## 2.16.0

### Minor Changes

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - - Generated Dockerfiles are proper multi-stage builds on Node 22: dependencies are installed and compiled in a build stage, only `dist` and production dependencies reach the runtime image, the container runs as the unprivileged `node` user, and pnpm is pinned. A `.dockerignore` keeps `node_modules`, `.env` and the genesis file out of the image.

  - Generated projects declare `engines.node >= 22`, pin tsdown 0.16 with `fixedExtension: false` so the output stays `dist/index.js`, depend on the 2.16 line of the eclesia packages, and ship the project license as `LICENSE.md`.

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - - Generated projects get a random Postgres password and Hasura admin secret written to `.env`; `docker-compose.yml` reads them from there, Hasura waits for Postgres and runs with dev mode off. The connection string in `src/index.ts` no longer carries a password.
  - The project name, chain name, chain prefix and description are validated at the prompt (and the project name on the command line), and template substitution escapes values for JSON and ignores `$`-patterns in user input.
  - The Bank module can be selected without genesis processing; balances are then tracked as changes from the start height, and the scaffolder says so.

### Patch Changes

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - A failed build in the scaffolded project is reported as a build failure rather than an installation failure; dead code removed.

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - - The CLI starts again: the bin shim imported `dist/index.js`, but tsdown 0.16 emits `dist/index.mjs`, so `npx create-eclesia-indexer` failed with `ERR_MODULE_NOT_FOUND`. The `exports`, `module` and `types` fields point at the emitted files as well.

  - The generated `docker-compose.yml` no longer binds host port 8888 twice; Hasura is mapped to 8080, the port it listens on.

- [#31](https://github.com/allinbits/eclesia-indexer-core/pull/31) [`3769eca`](https://github.com/allinbits/eclesia-indexer-core/commit/3769eca834ea5969dfb0de4a0a967d81d708665f) Thanks [@clockworkgr](https://github.com/clockworkgr)! - Generated projects load `.env` at startup (via `dotenv`), only set `genesisPath` when genesis processing is enabled (so declining genesis no longer throws a missing-file error on start), get a `.gitignore`, and omit the genesis volume from `docker-compose.yml` when genesis is not processed. The generated README no longer references a `.env.example` that was never created.

## 1.2.0

### Minor Changes

- Benchmark improvements and RPC bug

## 1.1.0

### Minor Changes

- 6515c03: CEI points to prerelease

## 1.1.0-next.0

### Minor Changes

- 6515c03: CEI points to prerelease

## 1.0.11

### Patch Changes

- 1461d21: Updated docs and minor bug fixes

## 1.0.10

### Patch Changes

- 378e461: Minor bug fixes

## 1.0.9

### Patch Changes

- fix: RPC exception handling

## 1.0.8

### Patch Changes

- 32ade0a: chore: Update deps

## 1.0.7

### Patch Changes

- chore: fix healthcheck db name

## 1.0.6

### Patch Changes

- Add RPC timeout

## 1.0.5

### Patch Changes

- fix events buf

## 1.0.4

### Patch Changes

- Debug indexer

## 1.0.3

### Patch Changes

- Fix events for comet38

## 1.0.2

### Patch Changes

- efd78ac: Fix comet 38 events
- 8631218: Polling fix

## 1.0.1

### Patch Changes

- b68bcda: Added changesets versioning
