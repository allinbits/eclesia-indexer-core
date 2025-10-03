# Eclesia Indexer Tutorial

This tutorial walks you through creating and running your first blockchain indexer using the AtomOne mainnet.

## Prerequisites

Before starting, ensure you have the following installed:

- **Docker** - Required for running the indexer stack
- **Node.js v20** - Required for running the indexer application

## Preparation

Download the AtomOne genesis file from:
```
https://atomone.fra1.digitaloceanspaces.com/atomone-1/genesis.json
```

Save this file to a location you can reference later.

## Step 1: Create Your Indexer

Generate the indexer boilerplate:

<tabs>
<tab label="npm">

```bash
npx create-eclesia-indexer@latest
```

</tab>
<tab label="pnpm">

```bash
pnpm create eclesia-indexer
```

</tab>
<tab label="yarn">

```bash
yarn create eclesia-indexer
```

</tab>
</tabs>

## Step 2: Configuration Prompts

You'll be asked a series of questions to configure your indexer. Use the following values:

### Basic Information

| Prompt | Value | Notes |
|--------|-------|-------|
| **Project name** | `a1-indexer` | You can use any name you prefer |
| **Chain name** | `AtomOne Mainnet` | |
| **Chain address prefix** | `atone` | AtomOne's address prefix |
| **Description** | _Your choice_ | Optional project description |

### Network Configuration

| Prompt | Value | Notes |
|--------|-------|-------|
| **RPC endpoint** | `wss://rpc-atomone.toschdev.com` | Publicly available full history/state node |
| **Minimal block indexing** | `No` | We want to see the full capabilities of Eclesia Indexer |
| **Blocks to prefetch** | `5` | Conservative setting for community nodes |
| **Starting height** | `1` | Index from genesis (default) |

### Genesis & Modules

| Prompt | Value | Notes |
|--------|-------|-------|
| **Process genesis file?** | `Yes` | |
| **Genesis file path** | _Your download path_ | e.g., `/my/download/path/genesis.json` |
| **Modules** | _Default selection_ | Auth, Bank, and Staking (press Enter) |

### Development Settings

| Prompt | Value | Notes |
|--------|-------|-------|
| **Package manager** | _Your preference_ | pnpm, yarn, or npm |
| **Log level** | `debug` | Default setting (recommended) |

The scaffolding process will now begin.

## Step 3: Start Your Indexer

Once scaffolding is complete, navigate to your project:

```bash
cd a1-indexer
```

Start the indexer stack:

<tabs>
<tab label="npm">

```bash
npm run local-dev:start
```

</tab>
<tab label="pnpm">

```bash
pnpm local-dev:start
```

</tab>
<tab label="yarn">

```bash
yarn local-dev:start
```

</tab>
</tabs>

### What Happens Next

1. **Docker images build** - This takes a couple of minutes on first run
2. **Three containers start**:
   - PostgreSQL (database)
   - Hasura (GraphQL API)
   - Eclesia Indexer (indexer service)

### Monitoring Progress

View indexer logs using either:

- **Docker Desktop** - Navigate to the container logs
- **Command line**:
  ```bash
  docker logs -f a1-indexer-indexer-1
  ```

## Expected Behavior

### Genesis Processing
The indexer will spend a few minutes processing the genesis file. You'll see this activity in the logs.

### Block 1 Processing
Block 1 takes extra time to process because AtomOne had autostaking enabled, which requires the staking module to build initial state for all accounts.

### Subsequent Blocks
After block 1, the indexer will process blocks sequentially at normal speed.

## Performance Notes

> **⚠️ Note on Public Nodes**
>
> Publicly available remote nodes may be slow due to network latency and shared resources.
>
> **Recommended Setup**: For optimal syncing performance, run the indexer alongside a local node. Network latencies add up quickly during initial sync. Once caught up to the latest block, network requirements become less critical.

## Next Steps

Your indexer is now running! You can:

- Access the Hasura GraphQL console to query indexed data
- Monitor indexing progress through the logs
- Customize modules and indexing logic as needed

Happy indexing!