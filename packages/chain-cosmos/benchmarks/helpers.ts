/**
 * Helper utilities for benchmarking the Cosmos adapter on the engine
 */

import {
  CometClient,
} from "@cosmjs/tendermint-rpc";
import {
  EclesiaIndexer, Types,
} from "@eclesia/indexer-engine";

import {
  cosmos, CosmosAdapter, Mocks,
} from "../src/index.js";

/** Benchmark configuration options */
export interface BenchmarkConfig {
  /** Number of blocks to process */
  blockCount: number
  /** Number of transactions per block */
  txsPerBlock: number
  /** Batch size for block processing */
  batchSize: number
  /** Height to end the processing */
  endHeight?: number
  /** Chain ID for synthetic data */
  chainId?: string
}

/**
 * Creates an indexer on the Cosmos adapter whose clients are the in-memory mock node
 */
export function createBenchmarkIndexer(config: BenchmarkConfig): {
  indexer: EclesiaIndexer<CosmosAdapter>
  mockRpc: Mocks.MockRpcClient
} {
  const mockRpc = new Mocks.MockRpcClient({
    chainId: config.chainId ?? "benchmark-chain",
    txPerBlock: config.txsPerBlock,
    startHeight: 1,
    endHeight: config.blockCount,
  });
  let counter = 0;
  const indexerConfig: Types.EclesiaIndexerConfig<CosmosAdapter> = {
    chain: cosmos({
      connect: async () => mockRpc as unknown as CometClient,
    }),
    rpcUrl: "http://mock-rpc:26657",
    batchSize: config.batchSize,
    modules: [],
    logLevel: "error",
    minimal: true,
    usePolling: true,
    enableHealthcheck: false,
    enablePrometheus: false,
    endHeight: config.endHeight,
    getNextHeight: async () => {
      counter++;
      return counter;
    },
    beginTransaction: async () => {
      await Promise.resolve();
    },
    endTransaction: async (_status: boolean) => {
      await Promise.resolve();
    },
    shouldProcessGenesis: async () => false,
  };

  return {
    indexer: new EclesiaIndexer(indexerConfig),
    mockRpc,
  };
}

/**
 * Process a range of blocks through the adapter directly and measure performance
 */
export async function processBlockRange(
  indexer: EclesiaIndexer<CosmosAdapter>,
  mockRpc: Mocks.MockRpcClient,
  startHeight: number,
  endHeight: number,
): Promise<{
  duration: number
  blocksPerSecond: number
}> {
  const start = Date.now();
  const client = mockRpc as unknown as CometClient;

  for (let height = startHeight; height <= endHeight; height++) {
    const fetched = await indexer.chain.fetchBlock(client, height, {
      log: indexer.log,
      prometheus: null,
      minimal: true,
    });
    await indexer.chain.processBlock(fetched, {
      emit: indexer.asyncEmit,
      log: indexer.log,
      prometheus: null,
      height: fetched.height,
      timestamp: fetched.timestamp,
      minimal: true,
    });
  }

  const duration = Date.now() - start;
  const blockCount = endHeight - startHeight + 1;
  const blocksPerSecond = (blockCount / duration) * 1000;

  return {
    duration,
    blocksPerSecond,
  };
}

/**
 * Starts an indexer against the mock RPC, waits until the block at `lastHeight` has been
 * processed, then tears the indexer down. Used by the throughput benchmarks so every
 * iteration measures a complete start-process-stop cycle.
 */
export async function runUntilHeight(indexer: EclesiaIndexer<CosmosAdapter>, lastHeight: number): Promise<void> {
  const done = new Promise<void>((resolve) => {
    indexer.on("block", (data) => {
      if ((data.height ?? 0) >= lastHeight) {
        resolve();
      }
    });
  });
  indexer.start().catch(() => { /* surfaced through the block event never arriving */ });
  await done;
  await indexer.stop();
}
