# @eclesia/core-modules-pg (deprecated)

Renamed to [`@eclesia/cosmos-modules-pg`](https://www.npmjs.com/package/@eclesia/cosmos-modules-pg) in 4.0.0, when the
eclesia engine became chain-agnostic and grew adapters for other chains. This package re-exports the Cosmos modules
unchanged so existing imports keep working for one release.

```diff
- import { AuthModule, BankModule, Blocks, StakingModule } from "@eclesia/core-modules-pg";
+ import { AuthModule, BankModule, Blocks, StakingModule } from "@eclesia/cosmos-modules-pg";
```

Cosmos indexers also need the chain adapter now:

```ts
import { cosmos } from "@eclesia/chain-cosmos";
const indexer = new PgIndexer({ ...config, chain: cosmos() }, modules);
```
