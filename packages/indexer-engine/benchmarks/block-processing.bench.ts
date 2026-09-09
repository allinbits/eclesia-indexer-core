import {
  bench, describe,
} from "vitest";

import {
  createBenchmarkIndexer, runUntilHeight,
} from "./helpers.js";

/**
 * Block processing throughput of the engine alone: blocks come from the in-memory mock RPC
 * client and the transaction callbacks are no-ops, so the numbers measure fetch scheduling,
 * decoding, event dispatch and the start/stop lifecycle, not database or network cost.
 * Each iteration starts an indexer, processes every block, and tears the indexer down.
 */

describe.sequential("Block processing throughput (mock RPC, no database)", () => {
  bench("Process 100 blocks (10tx/block) - No listeners", async () => {
    const {
      indexer,
    } = createBenchmarkIndexer({
      blockCount: 100,
      txsPerBlock: 10,
      batchSize: 100,
      endHeight: 100,
      mockRpc: true,
    });
    await runUntilHeight(indexer, 100);
  }, {
    iterations: 5,
    warmupIterations: 5,
    time: 1,
  });

  bench("Process 100 blocks (100tx/block) - No listeners", async () => {
    const {
      indexer,
    } = createBenchmarkIndexer({
      blockCount: 100,
      txsPerBlock: 100,
      endHeight: 100,
      batchSize: 100,
      mockRpc: true,
    });
    await runUntilHeight(indexer, 100);
  }, {
    iterations: 5,
    warmupIterations: 5,
    time: 1,
  });

  bench("Process 100 blocks (10tx/block) - 10 listeners", async () => {
    const {
      indexer,
    } = createBenchmarkIndexer({
      blockCount: 100,
      txsPerBlock: 10,
      endHeight: 100,
      batchSize: 100,
      mockRpc: true,
    });
    for (let i = 0; i < 10; i++) {
      indexer.on("/cosmos.bank.v1beta1.MsgSend", async (_data: unknown) => {
        return await Promise.resolve();
      });
    }
    await runUntilHeight(indexer, 100);
  }, {
    iterations: 5,
    warmupIterations: 5,
    time: 1,
  });

  bench("Process 100 blocks (100tx/block) - 10 listeners", async () => {
    const {
      indexer,
    } = createBenchmarkIndexer({
      blockCount: 100,
      txsPerBlock: 100,
      endHeight: 100,
      batchSize: 100,
      mockRpc: true,
    });
    for (let i = 0; i < 10; i++) {
      indexer.on("/cosmos.bank.v1beta1.MsgSend", async (_data: unknown) => {
        return await Promise.resolve();
      });
    }
    await runUntilHeight(indexer, 100);
  }, {
    iterations: 5,
    warmupIterations: 5,
    time: 1,
  });

  bench("Process 100 blocks (5tx/block) - 10 listeners", async () => {
    const {
      indexer,
    } = createBenchmarkIndexer({
      blockCount: 100,
      txsPerBlock: 5,
      endHeight: 100,
      batchSize: 100,
      mockRpc: true,
    });
    for (let i = 0; i < 20; i++) {
      indexer.on("/cosmos.bank.v1beta1.MsgSend", async (_data: unknown) => {
        return await Promise.resolve();
      });
    }
    await runUntilHeight(indexer, 100);
  }, {
    iterations: 5,
    warmupIterations: 5,
    time: 1,
  });
  bench("Process 1000 blocks (10tx/block) - No listeners", async () => {
    const {
      indexer,
    } = createBenchmarkIndexer({
      blockCount: 1000,
      txsPerBlock: 10,
      batchSize: 300,
      endHeight: 1000,
      mockRpc: true,
    });
    await runUntilHeight(indexer, 1000);
  }, {
    iterations: 5,
    warmupIterations: 5,
    time: 1,
  });
  bench("Process 1000 blocks (100tx/block) - No listeners", async () => {
    const {
      indexer,
    } = createBenchmarkIndexer({
      blockCount: 1000,
      txsPerBlock: 100,
      batchSize: 300,
      endHeight: 1000,
      mockRpc: true,
    });
    await runUntilHeight(indexer, 1000);
  }, {
    iterations: 5,
    warmupIterations: 5,
    time: 1,
  });
  bench("Process 1000 blocks (10tx/block) - 10 listeners", async () => {
    const {
      indexer,
    } = createBenchmarkIndexer({
      blockCount: 1000,
      txsPerBlock: 10,
      batchSize: 300,
      endHeight: 1000,
      mockRpc: true,
    });
    for (let i = 0; i < 10; i++) {
      indexer.on("/cosmos.bank.v1beta1.MsgSend", async (_data: unknown) => {
        return await Promise.resolve();
      });
    }
    await runUntilHeight(indexer, 1000);
  }, {
    iterations: 5,
    warmupIterations: 5,
    time: 1,
  });
  bench("Process 1000 blocks (100tx/block) - 10 listeners", async () => {
    const {
      indexer,
    } = createBenchmarkIndexer({
      blockCount: 1000,
      txsPerBlock: 100,
      batchSize: 300,
      endHeight: 1000,
      mockRpc: true,
    });
    for (let i = 0; i < 10; i++) {
      indexer.on("/cosmos.bank.v1beta1.MsgSend", async (_data: unknown) => {
        return await Promise.resolve();
      });
    }
    await runUntilHeight(indexer, 1000);
  }, {
    iterations: 5,
    warmupIterations: 5,
    time: 1,
  });
});
