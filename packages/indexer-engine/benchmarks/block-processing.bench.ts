import {
  bench, describe,
} from "vitest";

import {
  createBenchmarkIndexer,
} from "./helpers.js";

/**
 * Benchmarks for block processing performance
 * Measures data structure operations and block processing throughput
 */

describe.sequential("Block Data Processing - 100 blocks - No listeners", () => {
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
    indexer.start();
    let resolver: (value: unknown) => void;
    const done = new Promise((resolve) => {
      resolver = resolve;
    });
    indexer.on("block", (data: {
      height: number
    }) => {
      if (data.height >= 100) {
        resolver(true);
      }
    });
    await done;
    indexer.stop();
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
    indexer.start();
    let resolver: (value: unknown) => void;
    const done = new Promise((resolve) => {
      resolver = resolve;
    });
    indexer.on("block", (data: {
      height: number
    }) => {
      if (data.height >= 100) {
        resolver(true);
      }
    });
    await done;
    indexer.stop();
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
    indexer.start();
    let resolver: (value: unknown) => void;
    const done = new Promise((resolve) => {
      resolver = resolve;
    });
    for (let i = 0; i < 10; i++) {
      indexer.on("/cosmos.bank.v1beta1.MsgSend", async (_data: unknown) => {
        return await Promise.resolve();
      });
    }
    indexer.on("block", (data: {
      height: number
    }) => {
      if (data.height >= 100) {
        resolver(true);
      }
    });
    await done;
    indexer.stop();
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
    indexer.start();
    let resolver: (value: unknown) => void;
    const done = new Promise((resolve) => {
      resolver = resolve;
    });
    for (let i = 0; i < 10; i++) {
      indexer.on("/cosmos.bank.v1beta1.MsgSend", async (_data: unknown) => {
        return await Promise.resolve();
      });
    }
    indexer.on("block", (data: {
      height: number
    }) => {
      if (data.height >= 100) {
        resolver(true);
      }
    });
    await done;
    indexer.stop();
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
    indexer.start();
    let resolver: (value: unknown) => void;
    const done = new Promise((resolve) => {
      resolver = resolve;
    });
    for (let i = 0; i < 20; i++) {
      indexer.on("/cosmos.bank.v1beta1.MsgSend", async (_data: unknown) => {
        return await Promise.resolve();
      });
    }
    indexer.on("block", (data: {
      height: number
    }) => {
      if (data.height >= 100) {
        resolver(true);
      }
    });
    await done;
    indexer.stop();
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
      mockRpc: true,
    });
    indexer.start();
    let resolver: (value: unknown) => void;
    const done = new Promise((resolve) => {
      resolver = resolve;
    });
    indexer.on("block", (data: {
      height: number
    }) => {
      if (data.height >= 1000) {
        resolver(true);
      }
    });
    await done;
    indexer.stop();
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
      mockRpc: true,
    });
    indexer.start();
    let resolver: (value: unknown) => void;
    const done = new Promise((resolve) => {
      resolver = resolve;
    });
    indexer.on("block", (data: {
      height: number
    }) => {
      if (data.height >= 1000) {
        resolver(true);
      }
    });
    await done;
    indexer.stop();
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
      mockRpc: true,
    });
    indexer.start();
    let resolver: (value: unknown) => void;
    const done = new Promise((resolve) => {
      resolver = resolve;
    });
    for (let i = 0; i < 10; i++) {
      indexer.on("/cosmos.bank.v1beta1.MsgSend", async (_data: unknown) => {
        return await Promise.resolve();
      });
    }
    indexer.on("block", (data: {
      height: number
    }) => {
      if (data.height >= 1000) {
        resolver(true);
      }
    });
    await done;
    indexer.stop();
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
      mockRpc: true,
    });
    indexer.start();
    let resolver: (value: unknown) => void;
    const done = new Promise((resolve) => {
      resolver = resolve;
    });
    for (let i = 0; i < 10; i++) {
      indexer.on("/cosmos.bank.v1beta1.MsgSend", async (_data: unknown) => {
        return await Promise.resolve();
      });
    }
    indexer.on("block", (data: {
      height: number
    }) => {
      if (data.height >= 1000) {
        resolver(true);
      }
    });
    await done;
    indexer.stop();
  }, {
    iterations: 5,
    warmupIterations: 5,
    time: 1,
  });
});
