import {
  PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  gno, GnoAdapter, Mocks,
} from "@eclesia/chain-gno";
import {
  Types,
} from "@eclesia/indexer-engine";
import {
  Tm2Client,
} from "@gnolang/tm2-rpc";
import {
  Mock, vi,
} from "vitest";
import * as winston from "winston";

/**
 * Shared harness for the module unit tests: a fake PgIndexer that records every query, and a
 * dispatcher that runs the gno adapter over the mock node and routes each emitted event to the
 * handlers the module registered, so tests exercise real decoding against a fake database.
 */

export const log = winston.createLogger({
  level: "error",
  transports: [new winston.transports.Console()],
});

export type Harness = {
  pgIndexer: PgIndexer<GnoAdapter>
  query: Mock
  on: Mock
  warn: Mock
  /** Runs the adapter over one mock block and dispatches its events to the registered handlers */
  processBlock: (height: number, options?: {
    minimal?: boolean
    node?: Partial<Mocks.MockTm2Config>
  }) => Promise<void>
  /** Dispatches one event by name to the registered handlers */
  dispatch: (type: string, event: unknown) => Promise<void>
  /** Queries recorded under a prepared-statement name */
  calls: (name: string) => unknown[][]
};

export function harness(): Harness {
  const query = vi.fn(async () => ({
    rows: [],
    rowCount: 1,
  }));
  const on = vi.fn();
  const warn = vi.fn();
  const pgIndexer = {
    getInstance: () => ({
      query,
    }),
    applyMigrations: vi.fn().mockResolvedValue(0),
    beginTransaction: vi.fn(),
    endTransaction: vi.fn(),
    modules: {
    },
    indexer: {
      log: {
        ...log,
        warn,
        silly: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        isSillyEnabled: () => false,
      },
      on,
      asyncEmit: vi.fn(),
      prometheus: null,
    },
  } as unknown as PgIndexer<GnoAdapter>;

  const dispatch = async (type: string, event: unknown) => {
    for (const [name, handler] of on.mock.calls as Array<[string, (e: unknown) => Promise<void>]>) {
      if (name === type) {
        await handler(event);
      }
    }
  };

  const processBlock: Harness["processBlock"] = async (height, options = {
  }) => {
    const adapter = gno();
    const node = Mocks.createMockTm2Client({
      chainId: "unit-gno-1",
      txPerBlock: 4,
      startHeight: 1,
      endHeight: 10,
      ...options.node,
    }) as Tm2Client;
    const minimal = options.minimal ?? false;
    const fetched = await adapter.fetchBlock(node, height, {
      log,
      prometheus: null,
      minimal,
    });
    await adapter.processBlock(fetched, {
      emit: dispatch as never,
      log,
      prometheus: null,
      height: fetched.height,
      timestamp: fetched.timestamp,
      minimal,
    });
  };

  return {
    pgIndexer,
    query,
    on,
    warn,
    processBlock,
    dispatch,
    calls: name => (query.mock.calls as unknown[][])
      .filter(call => (call[0] as {
        name?: string
      }).name === name)
      .map(call => (call[0] as {
        values: unknown[]
      }).values),
  };
}

/** Installs a module on the harness the way PgIndexer would */
export function install(h: Harness, module: Types.IndexingModule<GnoAdapter>): void {
  module.init(h.pgIndexer);
}
