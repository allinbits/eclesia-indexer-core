/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  randomBytes,
} from "node:crypto";

import {
  PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  AuthModule, BankModule, Blocks,
} from "@eclesia/core-modules-pg";
import {
  Mocks,
} from "@eclesia/indexer-engine";
import pg from "pg";
import {
  afterAll, beforeAll, describe, expect, it,
} from "vitest";

/**
 * End-to-end: the PostgreSQL indexer with the core modules, driven by the in-memory mock RPC
 * client, against a real PostgreSQL database. Runs when E2E_PG_CONNECTION_STRING points at a
 * server the test may create databases on (CI provides one; locally any Postgres works).
 *
 * Both CometBFT response shapes are exercised: 0.37 (begin/end block lists, structured tx logs)
 * and 0.38 (finalize_block_events tagged with mode, msg_index attributes).
 */

const admin = process.env.E2E_PG_CONNECTION_STRING;
const BLOCKS = 30;
const TXS_PER_BLOCK = 3;

const scenario = (cometVersion: "0.37" | "0.38") => {
  let dbName = "";
  let connectionString = "";

  const withDb = (url: string, name: string) => {
    const parsed = new URL(url);
    parsed.pathname = "/" + name;
    return parsed.toString();
  };

  beforeAll(async () => {
    dbName = "eclesia_e2e_" + randomBytes(4).toString("hex");
    const client = new pg.Client({
      connectionString: admin,
    });
    await client.connect();
    await client.query(`CREATE DATABASE ${dbName}`);
    await client.end();
    connectionString = withDb(admin!, dbName);
  });

  afterAll(async () => {
    const client = new pg.Client({
      connectionString: admin,
    });
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await client.end();
  });

  it(`indexes ${BLOCKS} blocks from a CometBFT ${cometVersion} node into PostgreSQL`, async () => {
    const mock = Mocks.createMockRpcClient({
      chainId: "e2e-" + cometVersion,
      txPerBlock: TXS_PER_BLOCK,
      startHeight: 1,
      endHeight: BLOCKS,
      cometVersion,
    });
    const indexer = new PgIndexer({
      startHeight: 1,
      endHeight: BLOCKS,
      batchSize: 10,
      modules: [],
      rpcUrl: "http://mock-rpc:26657",
      logLevel: "warn",
      usePolling: true,
      pollingInterval: 50,
      minimal: false,
      enableHealthcheck: false,
      enablePrometheus: false,
      dbConnectionString: connectionString,
      exitOnFatal: false,
    }, [new Blocks.FullBlocksModule([]), new AuthModule([]), new BankModule([])]);
    // Point the engine at the mock instead of a network RPC
    const engine = indexer.indexer as any;
    engine.client = mock;
    engine.blockClient = mock;
    engine.connect = async () => true;

    await indexer.setup();
    await indexer.run(); // resolves once endHeight is reached and the engine has stopped
    await indexer.stop();

    const db = new pg.Client({
      connectionString,
    });
    await db.connect();
    try {
      const blocks = await db.query("SELECT count(*)::int AS n, min(height)::int AS lo, max(height)::int AS hi FROM blocks");
      expect(blocks.rows[0]).toEqual({
        n: BLOCKS,
        lo: 1,
        hi: BLOCKS,
      });

      const txs = await db.query("SELECT count(*)::int AS n, count(DISTINCT height)::int AS heights FROM transactions");
      expect(txs.rows[0]).toEqual({
        n: BLOCKS * TXS_PER_BLOCK,
        heights: BLOCKS,
      });

      const migrations = await db.query("SELECT module, version FROM schema_migrations ORDER BY module, version");
      expect(migrations.rows.map(r => `${r.module}@${r.version}`)).toEqual(["blocks-full@1", "blocks-full@2", "cosmos.auth.v1beta1@1", "cosmos.bank.v1beta1@1", "cosmos.bank.v1beta1@2"]);

      // Block-level flows: the fee collector receives 50uatom per block and spends 5 (0.38 delivers
      // them tagged with mode=BeginBlock/EndBlock, 0.37 as separate lists). The auth module snapshots
      // the module accounts at height 1 once block 2 starts, so from height 2 onwards the balance
      // must be 1000000 (snapshot) + 45 per block.
      const feeCollector = Mocks.mockModuleAccounts().fee_collector;
      const snapshot = await db.query("SELECT (unnest(coins)).amount FROM balances WHERE address = $1 AND height = 1", [feeCollector]);
      expect(snapshot.rows.map(r => r.amount)).toEqual(["1000000"]);
      const latest = await db.query("SELECT (unnest(coins)).amount, height FROM balances WHERE address = $1 ORDER BY height DESC LIMIT 1", [feeCollector]);
      expect(Number(latest.rows[0].height)).toBe(BLOCKS);
      expect(latest.rows[0].amount).toBe(String(1000000 + 45 * (BLOCKS - 1)));

      // Per-transaction flows are attributed through the tx log (0.37) or msg_index attributes (0.38)
      const receiver = await db.query("SELECT (unnest(coins)).amount FROM balances WHERE address = $1 ORDER BY height DESC LIMIT 1", [Mocks.syntheticAddress("cosmos", 2)]);
      expect(receiver.rows[0].amount).toBe(String(10 * TXS_PER_BLOCK * BLOCKS));

      const ts = await db.query("SELECT data_type FROM information_schema.columns WHERE table_name = 'blocks' AND column_name = 'timestamp'");
      expect(ts.rows[0].data_type).toBe("timestamp with time zone");
    }
    finally {
      await db.end();
    }
  }, 120000);
};

describe.skipIf(!admin)("end-to-end indexing", () => {
  describe("CometBFT 0.37", () => scenario("0.37"));
  describe("CometBFT 0.38", () => scenario("0.38"));
});

if (!admin) {
  describe("end-to-end indexing", () => {
    it.skip("set E2E_PG_CONNECTION_STRING to a PostgreSQL server the test may create databases on", () => {});
  });
}
