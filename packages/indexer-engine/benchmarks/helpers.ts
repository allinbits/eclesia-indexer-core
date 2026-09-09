/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Helper utilities for benchmarking
 */

import {
  CometClient,
} from "@cosmjs/tendermint-rpc";

import {
  EclesiaIndexer, Mocks,
  Types,
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
  /** Whether to mock RPC client */
  mockRpc?: boolean
  /** Chain ID for synthetic data */
  chainId?: string
}

/**
 * Creates a mock indexer for benchmarking
 */
export function createBenchmarkIndexer(config: BenchmarkConfig): {
  indexer: EclesiaIndexer
  mockRpc: CometClient
} {
  const mockRpc = Mocks.createMockRpcClient({
    chainId: config.chainId ?? "benchmark-chain",
    txPerBlock: config.txsPerBlock,
    startHeight: 1,
    endHeight: config.blockCount,
  });
  let counter = 0;
  const indexerConfig: Types.EclesiaIndexerConfig = {
    rpcUrl: "http://mock-rpc:26657",
    batchSize: config.batchSize,
    modules: [],
    logLevel: "error",
    minimal: true,
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

  const indexer = new EclesiaIndexer(indexerConfig);

  // Replace RPC clients with mocks if requested
  if (config.mockRpc !== false) {
    (indexer as any).client = mockRpc;
    (indexer as any).blockClient = mockRpc;
    (indexer as any).initialized = true;
    (indexer as any).connect = () => Promise.resolve(true);
  }

  return {
    indexer,
    mockRpc,
  };
}

/**
 * Process a range of blocks and measure performance
 */
export async function processBlockRange(
  indexer: EclesiaIndexer,
  mockRpc: Mocks.MockRpcClient,
  startHeight: number,
  endHeight: number,
): Promise<{
  duration: number
  blocksPerSecond: number
}> {
  const start = Date.now();

  for (let height = startHeight; height <= endHeight; height++) {
    const block = await mockRpc.block(height);
    const blockResults = await mockRpc.blockResults(height);
    await (indexer as any).processBlock(block, blockResults);
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
export async function runUntilHeight(indexer: EclesiaIndexer, lastHeight: number): Promise<void> {
  const done = new Promise<void>((resolve) => {
    indexer.on("block", (data: {
      height?: number
    }) => {
      if ((data.height ?? 0) >= lastHeight) {
        resolve();
      }
    });
  });
  indexer.start().catch(() => { /* surfaced through the block event never arriving */ });
  await done;
  await indexer.stop();
}
