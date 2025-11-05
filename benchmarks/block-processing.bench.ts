import {
  bench, describe,
} from "vitest";

/**
 * Benchmarks for block processing performance
 * Measures data structure operations and block processing throughput
 */

describe("Block Data Processing", () => {
  bench("Process 1000 block headers", () => {
    const blocks = Array.from({
      length: 1000,
    }, (_, i) => ({
      height: i + 1,
      time: new Date().toISOString(),
      chainId: "test-chain",
      hash: Buffer.from(`block-${i}`).toString("hex"),
    }));

    // Simulate processing
    const processed = blocks.map(block => ({
      ...block,
      processed: true,
      timestamp: Date.now(),
    }));

    return processed.length;
  });

  bench("JSON stringify 1000 block objects", () => {
    const blocks = Array.from({
      length: 1000,
    }, (_, i) => ({
      height: i + 1,
      time: new Date().toISOString(),
      chainId: "test-chain",
      hash: "a".repeat(64),
      transactions: Array.from({
        length: 10,
      }, (_, j) => `tx-${j}`),
    }));

    blocks.forEach(block => {
      JSON.stringify(block);
    });
  });

  bench("Hash generation for 1000 blocks", async () => {
    const crypto = await import("node:crypto");

    for (let i = 0; i < 1000; i++) {
      const hash = crypto.createHash("sha256");
      hash.update(`block-data-${i}`);
      hash.digest("hex");
    }
  });

  bench("Map operations (1000 inserts + lookups)", () => {
    const cache = new Map<number, string>();

    // Insert
    for (let i = 0; i < 1000; i++) {
      cache.set(i, `value-${i}`);
    }

    // Lookup
    for (let i = 0; i < 1000; i++) {
      cache.get(i);
    }

    // Cleanup
    cache.clear();
  });

  bench("Array operations (1000 items)", () => {
    const items = Array.from({
      length: 1000,
    }, (_, i) => ({
      id: i,
      data: `item-${i}`,
    }));

    // Filter
    items.filter(item => item.id % 2 === 0);

    // Map
    items.map(item => ({
      ...item, processed: true,
    }));

    // Find
    items.find(item => item.id === 500);
  });
});
