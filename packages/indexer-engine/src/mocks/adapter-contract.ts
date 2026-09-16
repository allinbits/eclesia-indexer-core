/* eslint-disable @stylistic/no-multi-spaces */
import * as winston from "winston";

import {
  ChainAdapter, FetchedBlock,
} from "../chain/index.js";

/** One check of the adapter contract; `run` throws when the adapter breaks it */
export type AdapterContractCase = {
  name: string
  run: () => Promise<void>
};

export type AdapterContractOptions = {
  url: string                 // Endpoint handed to connect()
  heights: [number, number]   // Inclusive range of heights the node can serve; at least two blocks
  network?: string            // Expected network id, when known
};

function check(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error("Adapter contract violated: " + message);
  }
}

const quietLog = winston.createLogger({
  level: "error",
  transports: [new winston.transports.Console()],
});

/**
 * Behavioural checks every chain adapter must pass, expressed without a test framework so each
 * chain package can run them under its own runner:
 *
 *   it.each(adapterContractCases(gno(), { url, heights: [1, 5] }))("$name", c => c.run());
 *
 * They exercise the adapter against a real or mock node: connect and status, fetching blocks in
 * order, the height and timestamp every emitted event must carry, and the optional subscription
 * and query methods when present.
 */
export function adapterContractCases<TClient, TBlock>(adapter: ChainAdapter<TClient, TBlock>, options: AdapterContractOptions): AdapterContractCase[] {
  const [first, last] = options.heights;
  const fetchContext = {
    log: quietLog,
    prometheus: null,
    minimal: true,
  };
  const withClient = async (fn: (client: TClient) => Promise<void>) => {
    const client = await adapter.connect(options.url);
    try {
      await fn(client);
    }
    finally {
      await adapter.disconnect(client);
    }
  };

  return [
    {
      name: "has a name and the mandatory methods",
      run: async () => {
        check(typeof adapter.name === "string" && adapter.name.length > 0, "name must be a non-empty string");
        for (const method of ["connect", "disconnect", "status", "fetchBlock", "processBlock"] as const) {
          check(typeof adapter[method] === "function", method + "() is required");
        }
      },
    },
    {
      name: "connects, reports status, and tolerates a second disconnect",
      run: async () => {
        const client = await adapter.connect(options.url);
        const status = await adapter.status(client);
        check(typeof status.network === "string" && status.network.length > 0, "status().network must be a non-empty string");
        check(Number.isInteger(status.latestHeight) && status.latestHeight >= last, "status().latestHeight must be an integer at or above the last servable height");
        if (options.network !== undefined) {
          check(status.network === options.network, "status().network must be " + options.network + ", got " + status.network);
        }
        await adapter.disconnect(client);
        await adapter.disconnect(client);
      },
    },
    {
      name: "fetches blocks whose height and timestamp match the request",
      run: () => withClient(async (client) => {
        let previous: FetchedBlock<TBlock> | undefined;
        for (let height = first; height <= last; height++) {
          const fetched = await adapter.fetchBlock(client, height, fetchContext);
          check(fetched.height === height, "fetchBlock(" + height + ") returned height " + fetched.height);
          check(typeof fetched.timestamp === "string" && !Number.isNaN(Date.parse(fetched.timestamp)), "fetchBlock(" + height + ") timestamp must parse as a date: " + fetched.timestamp);
          check(fetched.data !== undefined && fetched.data !== null, "fetchBlock(" + height + ") must carry data");
          if (previous) {
            check(Date.parse(fetched.timestamp) >= Date.parse(previous.timestamp), "block timestamps must not go backwards");
          }
          previous = fetched;
        }
      }),
    },
    {
      name: "fetches the same height in minimal and full mode",
      run: () => withClient(async (client) => {
        const minimal = await adapter.fetchBlock(client, first, fetchContext);
        const full = await adapter.fetchBlock(client, first, {
          ...fetchContext,
          minimal: false,
        });
        check(minimal.height === full.height && minimal.timestamp === full.timestamp, "minimal and full fetches of one height must agree on height and timestamp");
      }),
    },
    {
      name: "stamps every emitted event with the block's height and timestamp",
      run: () => withClient(async (client) => {
        const fetched = await adapter.fetchBlock(client, first, {
          ...fetchContext,
          minimal: false,
        });
        const emitted: Array<{
          type: string
          height?: number
          timestamp?: string
        }> = [];
        await adapter.processBlock(fetched, {
          emit: (async (type: string, event: {
            height?: number
            timestamp?: string
          }) => {
            emitted.push({
              type,
              height: event.height,
              timestamp: event.timestamp,
            });
          }) as never,
          log: quietLog,
          prometheus: null,
          height: fetched.height,
          timestamp: fetched.timestamp,
          minimal: false,
        });
        check(emitted.length > 0, "processBlock must emit at least one event");
        for (const event of emitted) {
          check(event.height === fetched.height, "event " + event.type + " carries height " + event.height + " instead of " + fetched.height);
          check(event.timestamp === fetched.timestamp, "event " + event.type + " carries timestamp " + event.timestamp + " instead of " + fetched.timestamp);
        }
      }),
    },
    {
      name: "subscribeNewBlock, when present, returns a detach function or null",
      run: () => withClient(async (client) => {
        if (!adapter.subscribeNewBlock) {
          return;
        }
        const unsubscribe = adapter.subscribeNewBlock(client, {
          next: () => {},
          error: () => {},
          complete: () => {},
        });
        check(unsubscribe === null || typeof unsubscribe === "function", "subscribeNewBlock must return a function or null");
        if (unsubscribe) {
          unsubscribe();
        }
      }),
    },
    {
      name: "abciQuery, when present, answers an unknown path with a code instead of throwing",
      run: () => withClient(async (client) => {
        if (!adapter.abciQuery) {
          return;
        }
        const reply = await adapter.abciQuery(client, "/eclesia.contract/does-not-exist", new Uint8Array());
        check(typeof reply.code === "number" && reply.code !== 0, "an unknown query path must come back with a non-zero code");
        check(reply.value instanceof Uint8Array, "abciQuery must return value as a Uint8Array");
      }),
    },
  ];
}
