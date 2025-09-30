import {
  describe, expect, it,
} from "vitest";

import {
  CircularBuffer, PromiseQueue,
} from "./";

/**
 * Test suite for promise-based queue implementations
 * Tests both PromiseQueue (FIFO) and CircularBuffer (fixed-size circular) implementations
 * Used by the blockchain indexer for managing block processing pipelines
 */

describe(
  "PromiseQueue", () => {
    it(
      "should initialize with a fixed batch size", () => {
        const queue = new PromiseQueue<number>(5);
        expect(queue.size()).toBe(1); // Initial promise for the next item
        expect(queue.isEmpty()).toBe(false);
      },
    );

    it(
      "should enqueue items and increase size", () => {
        const queue = new PromiseQueue<number>(3);
        queue.enqueue(1);
        queue.enqueue(2);
        expect(queue.size()).toBe(3); // Includes the initial promise
      },
    );

    it(
      "should dequeue items and decrease size", async () => {
        const queue = new PromiseQueue<number>(3);
        queue.enqueue(1);
        queue.enqueue(2);
        const item = await queue.dequeue();
        expect(item).toBe(1);
        expect(queue.size()).toBe(2);
      },
    );

    it(
      "should resolve continue when space is available", async () => {
        const queue = new PromiseQueue<number>(2);
        queue.enqueue(1);
        queue.enqueue(2);
        const continuePromise = queue.continue();
        queue.dequeue();
        await expect(continuePromise).resolves.toBe(true);
      },
    );

    it(
      "should correctly identify if the queue is empty", () => {
        const queue = new PromiseQueue<number>(3);
        expect(queue.isEmpty()).toBe(false); // Initial promise exists
        queue.dequeue();
        expect(queue.isEmpty()).toBe(true);
      },
    );

    it(
      "should set synced to true when setSynced is called", () => {
        const queue = new PromiseQueue<number>(3);
        expect(queue.synced).toBe(false);
        queue.setSynced();
        expect(queue.synced).toBe(true);
      },
    );
  },
);

describe(
  "CircularBuffer", () => {
    it(
      "should initialize with a fixed batch size", () => {
        const queue = new CircularBuffer<number>(5);
        expect(queue.size()).toBe(1);
        expect(queue.isEmpty()).toBe(false);
      },
    );

    it(
      "should enqueue items and increase size", () => {
        const queue = new CircularBuffer<number>(3);
        queue.enqueue(1);
        queue.enqueue(2);
        expect(queue.size()).toBe(3); // Includes the initial promise
      },
    );

    it(
      "should dequeue items and decrease size", async () => {
        const queue = new CircularBuffer<number>(3);
        queue.enqueue(1);
        queue.enqueue(2);
        const item = await queue.dequeue();
        expect(item).toBe(1);
        expect(queue.size()).toBe(2);
      },
    );

    it(
      "should resolve continue when space is available", async () => {
        const queue = new CircularBuffer<number>(2);
        queue.enqueue(1);
        queue.enqueue(2);
        const continuePromise = queue.continue();
        queue.dequeue();
        await expect(continuePromise).resolves.toBe(true);
      },
    );

    it(
      "should correctly identify if the queue is empty", () => {
        const queue = new CircularBuffer<number>(3);
        queue.enqueue(1);
        expect(queue.isEmpty()).toBe(false); // Initial promise exists
        queue.dequeue();
        expect(queue.isEmpty()).toBe(false);
      },
    );

    it(
      "should set synced to true when setSynced is called", () => {
        const queue = new CircularBuffer<number>(3);
        expect(queue.synced).toBe(false);
        queue.setSynced();
        expect(queue.synced).toBe(true);
      },
    );
  },
);
