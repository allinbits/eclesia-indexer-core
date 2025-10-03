# Eclesia Indexer Advanced Tutorial

This tutorial walks you through creating a custom indexing module for tracking IBC transfer statistics on the Cosmos Hub mainnet.

## Prerequisites

Before starting, ensure you have the following installed:

- **Docker** - Required for running the indexer stack
- **Node.js v20** - Required for running the indexer application
- **A code editor** - VSCode, Vim, or your preferred editor

## What You'll Build

In this tutorial, you'll create a custom module that:
- Tracks IBC transfer statistics per channel
- Stores historical data at different block heights
- Demonstrates advanced indexing patterns and custom event handling

## Step 1: Create Your Indexer

Generate the indexer boilerplate depending on your preferred package manager:

```bash
npx create-eclesia-indexer@latest # or pnpm create create-eclesia-indexer@latest or yarn create create-eclesia-indexer@latest
```

## Step 2: Configuration Prompts

You'll be asked a series of questions to configure your indexer. Use the following values:

### Basic Information

| Prompt | Value | Notes |
|--------|-------|-------|
| **Project name** | `ibc-indexer` | You can use any name you prefer |
| **Chain name** | `Cosmos Hub Mainnet` | |
| **Chain address prefix** | `cosmos` | Cosmos Hub's address prefix |
| **Description** | _Your choice_ | Optional project description |

### Network Configuration

| Prompt | Value | Notes |
|--------|-------|-------|
| **RPC endpoint** | `https://cosmos-rpc.polkachu.com` | Publicly available node |
| **Minimal block indexing** | `Yes` | We don't need additional block data |
| **Blocks to prefetch** | `5` | Conservative setting for community nodes |
| **Starting height** | `27790000` | Index from a recent height (adjust accordingly) |

### Genesis & Modules

| Prompt | Value | Notes |
|--------|-------|-------|
| **Process genesis file?** | `No` | Not needed for recent height indexing |
| **Modules** | _None_ | Deselect all and press Enter |

### Development Settings

| Prompt | Value | Notes |
|--------|-------|-------|
| **Package manager** | _Your preference_ | pnpm, yarn, or npm |
| **Log level** | `debug` | Default setting (recommended) |

The scaffolding process will now begin.

## Step 3: Set Up Your Project

Once scaffolding is complete, navigate to your project:

```bash
cd ibc-indexer
```

Open it with your preferred code editor. Now let's create the module structure:

```bash
mkdir -p src/modules/ibc_module/sql
```

## Step 4: Create the Database Schema

Create the file `src/modules/ibc_module/sql/module.sql` with the following content:

```sql
CREATE TABLE ibc_statistics
(
    channel     TEXT NOT NULL,
    transfers   INTEGER NOT NULL,
    height      BIGINT REFERENCES blocks (height),
    CONSTRAINT unique_height_channel UNIQUE (channel, height)
);

CREATE INDEX ibc_statistics_channel_index ON ibc_statistics (channel);
CREATE INDEX ibc_statistics_height_index ON ibc_statistics (height DESC NULLS LAST);
```

### Schema Explanation

- **channel** - The IBC channel identifier
- **transfers** - Cumulative count of transfers for this channel
- **height** - Block height reference (links to the core blocks table)
- **unique_height_channel** - Ensures one record per channel per height
- **Indexes** - Optimize queries by channel and recent height lookups

## Step 5: Implement the Module Logic

Create the file `src/modules/ibc_module/index.ts` with the following content:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import {
  fileURLToPath,
} from "node:url";

import {
  GeneratedType,
} from "@cosmjs/proto-signing";
import {
  PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  EcleciaIndexer, Types,
} from "@eclesia/indexer-engine";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the new indexing event we want to listen for
export type Events = {

  "/ibc.applications.transfer.v1.MsgTransfer": {
    value: Types.TxResult<Uint8Array>
  }
};

export class IbcModule implements Types.IndexingModule {
  indexer!: EcleciaIndexer;

  private pgIndexer!: PgIndexer;

  private registry: [string, GeneratedType][];

  // Give our module a name
  public name: string = "ibc-statistics";

  // If our module depends on other modules, list their names here
  public depends: string[] = [];

  // If a different module makes use of the data we generate, let's name our module as a provider
  public provides: string[] = ["ibc-statistics"];

  constructor(registry: [string, GeneratedType][]) {
    this.registry = registry;
  }

  async setup() {
    await this.pgIndexer.beginTransaction();
    const client = this.pgIndexer.getInstance();
    // Check if our table already exists and if not, create it
    const exists = await client.query(
      "SELECT EXISTS ( SELECT FROM pg_tables WHERE  schemaname = 'public' AND tablename  = 'ibc_statistics')",
    );
    if (!exists.rows[0].exists) {
      this.indexer.log.warn("Database not configured");
      const base = fs.readFileSync(__dirname + "/./sql/module.sql").toString();
      try {
        await client.query(base);
        this.indexer.log.info("DB has been set up");
        await this.pgIndexer.endTransaction(true);
      }
      catch (e) {
        await this.pgIndexer.endTransaction(false);
        throw new Error("" + e);
      }
    }
    else {
      await this.pgIndexer.endTransaction(true);
    }
  }

  init(pgIndexer: PgIndexer): void {
    this.pgIndexer = pgIndexer;
    this.indexer = pgIndexer.indexer;

    // Create a map of the registry for easy access
    const registryMap: Map<string, (typeof this.registry)[0][1]> = new Map();
    for (let i = 0; i < this.registry.length; i++) {
      registryMap.set(this.registry[i][0], this.registry[i][1]);
    }
    this.indexer.log.verbose("IBC Module: Msg Registry mapped");
    // Register our event listener
    this.indexer.on("/ibc.applications.transfer.v1.MsgTransfer", async (event) => {
      this.indexer.log.verbose("Indexing IBC transfer");
      if (!event.height) {
        this.indexer.log.error("Event height is undefined");
        return;
      }
      // Get the decoder from the registryMap and decode our MsgTransfer
      const MsgTransfer = registryMap.get("/ibc.applications.transfer.v1.MsgTransfer");
      if (!MsgTransfer) {
        this.indexer.log.error("Could not find MsgTransfer in registry");
        return;
      }
      const transfer = MsgTransfer.decode(event.value.tx);
      // Get the source channel from the message
      const channel = transfer.sourceChannel;
      // Update the statistics in the database
      await this.updateStatistics(channel, event.height);
    });
    this.indexer.log.verbose("IBC Module: Listeners registered");
  }

  async getStatistics(channel: string) {
    const db = this.pgIndexer.getInstance();
    // Fetch the latest statistics for the given channel
    const res = await db.query(
      "SELECT * FROM ibc_statistics WHERE channel = $1 ORDER BY height DESC LIMIT 1",
      [channel],
    );
    if (res.rowCount === 0) {
      return null;
    }
    return res.rows[0];
  }

  async updateStatistics(channel: string, height: number) {
    const db = this.pgIndexer.getInstance();
    const stats = (await this.getStatistics(channel));
    // Get the latest transfer count and increment it
    let count = 1;
    if (stats) {
      count = stats.transfers + 1;
    }

    // Upsert the statistics into the database.
    // Since we want to keep a history of counts at different heights, we use a unique constraint on (channel, height)
    // to consolidate multiple updates at the same height
    await db.query(
      `INSERT INTO ibc_statistics (channel, transfers, height)
       VALUES ($1, $2, $3)
       ON CONFLICT ON CONSTRAINT unique_height_channel DO UPDATE
       SET transfers = EXCLUDED.transfers, height = EXCLUDED.height`,
      [channel, count, height],
    );
  }
}
```

### Module Key Concepts

1. **Event Listeners** - The module registers listeners for specific transaction message types
2. **Registry Mapping** - Protocol buffer types are decoded using the registry
3. **Cumulative Statistics** - Transfer counts are incremented based on the latest value
4. **Historical Tracking** - Unique constraint on (channel, height) preserves history

## Step 6: Register Custom Events

Create the file `src/events.d.ts` to augment TypeScript types:

```typescript
import {
  Types,
} from "@eclesia/indexer-engine";

import {
  Events as IbcEvents,
} from "./modules/ibc_module";

declare global {

  export interface EventMap
    extends IbcEvents,
    Types.Events {
  }
}
```

This ensures proper type-checking for your custom events throughout the project.

## Step 7: Wire Up the Module

Open `src/index.ts` and modify it to include your custom module:

```typescript
>>>
import {
  Blocks,
} from "@eclesia/core-modules-pg";
// Import your new custom module
+ import {
+   IbcModule,
+ } from "./modules/ibc_module";
<<<

>>>
// Initialize modules
const blocksModule = new Blocks.MinimalBlocksModule(registry);
+ const ibcModule = new IbcModule(registry); // Instantiate your new custom module

+ const indexer = new PgIndexer(config, [blocksModule, ibcModule]); // Pass your instantiated module here
<<<
```

## Step 8: Build and Run

Build your project using your preferred package manager:

```bash
npm run build # or pnpm build or yarn build
```

Rebuild the Docker container:

```bash
npm run docker:build # or pnpm docker:build or yarn docker:build
```

Start the indexer:

```bash
npm run local-dev:start # or pnpm local-dev:start or yarn local-dev:start
```

### Monitoring Progress

View indexer logs using either:

- **Docker Desktop** - Navigate to the container logs
- **Command line**:
  ```bash
  docker logs -f ibc-indexer-indexer-1
  ```

## Expected Behavior

Your custom module will:

1. **Initialize the database** - Create the `ibc_statistics` table on first run
2. **Listen for IBC transfers** - Process MsgTransfer messages as they occur
3. **Update statistics** - Increment transfer counts per channel at each block height
4. **Maintain history** - Store snapshots at different heights for time-series analysis

## Querying Your Data

Access the Hasura GraphQL console to query your indexed IBC statistics. Example queries:

- Get latest statistics for all channels
- Track transfer count growth over time for a specific channel
- Compare activity across different IBC channels

## Key Takeaways

This tutorial demonstrated:

- **Custom module creation** - Structuring and implementing your own indexing logic
- **Event-driven indexing** - Registering listeners for specific message types
- **Database design** - Creating schemas optimized for time-series data
- **Type safety** - Augmenting TypeScript definitions for custom events
- **Module integration** - Wiring custom modules into the indexer pipeline

## Next Steps

Now that you've built a custom module, you can:

- Add more sophisticated statistics and aggregations
- Create additional custom modules for other message types
- Implement cross-module data dependencies
- Build GraphQL queries and subscriptions in Hasura
- Deploy your indexer to production

Happy indexing!
