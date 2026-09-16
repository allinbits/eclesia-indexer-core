import {
  randomBytes,
} from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  gno, Mocks, parseGenesisBalance,
} from "@eclesia/chain-gno";
import {
  Blocks, MessagesModule, PackagesModule, ValidatorsModule,
} from "@eclesia/gno-modules-pg";
import pg from "pg";
import {
  afterAll, beforeAll, describe, expect, it,
} from "vitest";

/**
 * End-to-end: the PostgreSQL indexer with the gno modules on the gno adapter, driven by the
 * mock Tendermint2 node, against a real PostgreSQL database. Runs when E2E_PG_CONNECTION_STRING
 * points at a server the test may create databases on.
 *
 * Covers the full mode (validator set per block), a failing transaction per block, the genesis
 * import (balances stream and a realm deployed at genesis) and the block-time averages.
 */

const admin = process.env.E2E_PG_CONNECTION_STRING;
const BLOCKS = 110;
const TXS_PER_BLOCK = 4;
const GENESIS_REALM = "gno.land/r/demo/hello";

describe.skipIf(!admin)("gno end-to-end", () => {
  let dbName = "";
  let connectionString = "";
  let genesisDir = "";

  const withDb = (url: string, name: string) => {
    const parsed = new URL(url);
    parsed.pathname = "/" + name;
    return parsed.toString();
  };

  beforeAll(async () => {
    dbName = "eclesia_gno_e2e_" + randomBytes(4).toString("hex");
    const client = new pg.Client({
      connectionString: admin,
    });
    await client.connect();
    await client.query(`CREATE DATABASE ${dbName}`);
    await client.end();
    connectionString = withDb(admin!, dbName);

    genesisDir = fs.mkdtempSync(path.join(os.tmpdir(), "eclesia-gno-genesis-"));
    fs.writeFileSync(path.join(genesisDir, "genesis.json"), JSON.stringify({
      chain_id: "e2e-gno",
      app_state: {
        balances: [
          // Amino string form, as gnoland and gnodev write it
          Mocks.syntheticAddress(1) + "=1000000000ugnot",
          Mocks.syntheticAddress(3) + "=100ugnot;vesting=100ugnot,0,1800000000;type=delayed",
          // Object form some tools write
          {
            address: Mocks.syntheticAddress(2),
            amount: "500ugnot",
          },
        ],
        txs: [
          {
            tx: {
              msg: [
                {
                  "@type": "/vm.m_addpkg",
                  creator: Mocks.syntheticAddress(7),
                  package: {
                    name: "hello",
                    path: GENESIS_REALM,
                    files: [
                      {
                        name: "hello.gno",
                        body: "package hello\n\nfunc Hello() string { return \"hello\" }\n",
                      },
                    ],
                  },
                  send: "",
                  max_deposit: "",
                },
                {
                  "@type": "/vm.m_call",
                  caller: Mocks.syntheticAddress(7),
                  pkg_path: GENESIS_REALM,
                  func: "Hello",
                  args: [],
                },
              ],
              fee: {
                gas_wanted: "1000000",
                gas_fee: "1ugnot",
              },
              signatures: [],
              memo: "",
            },
            metadata: {
              timestamp: "1700000000",
              block_height: "4242",
            },
          },
        ],
      },
    }));
  });

  afterAll(async () => {
    const client = new pg.Client({
      connectionString: admin,
    });
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await client.end();
    fs.rmSync(genesisDir, {
      recursive: true,
      force: true,
    });
  });

  it(`indexes genesis and ${BLOCKS} blocks from a Tendermint2 node into PostgreSQL`, async () => {
    const node = Mocks.createMockTm2Client({
      chainId: "e2e-gno",
      txPerBlock: TXS_PER_BLOCK,
      startHeight: 1,
      endHeight: BLOCKS,
      failEvery: 4, // the fourth transaction of every block (a MsgRun) fails
    });
    const indexer = new PgIndexer({
      chain: gno({
        connect: async () => node,
      }),
      chainId: "e2e-gno",
      startHeight: 1,
      endHeight: BLOCKS,
      batchSize: 10,
      modules: [],
      rpcUrl: "http://mock-rpc:26657",
      logLevel: "warn",
      pollingInterval: 50,
      minimal: false,
      processGenesis: true,
      genesisPath: path.join(genesisDir, "genesis.json"),
      enableHealthcheck: false,
      enablePrometheus: false,
      dbConnectionString: connectionString,
      exitOnFatal: false,
    }, [new Blocks.FullBlocksModule(), new MessagesModule(), new PackagesModule(), new ValidatorsModule()]);
    // The engine streams the balances only when something listens for them
    const genesisBalances: ReturnType<typeof parseGenesisBalance>[] = [];
    indexer.indexer.on("genesis/array/app_state.balances", async (event) => {
      genesisBalances.push(...event.value.map(parseGenesisBalance));
    });

    await indexer.setup();
    await indexer.run();
    await indexer.stop();

    expect(genesisBalances.map(b => b.amount)).toEqual(["1000000000ugnot", "100ugnot", "500ugnot"]);
    expect(genesisBalances[1].vesting).toEqual({
      originalVesting: "100ugnot",
      startTime: 0,
      endTime: 1800000000,
      delayed: true,
    });

    const db = new pg.Client({
      connectionString,
    });
    await db.connect();
    try {
      const blocks = await db.query("SELECT count(*)::int AS n, min(height)::int AS lo, max(height)::int AS hi, bool_and(hash ~ '^[0-9A-F]{64}$') AS hashes, bool_and(proposer_address LIKE 'g1%') AS proposers FROM blocks");
      expect(blocks.rows[0]).toEqual({
        n: BLOCKS,
        lo: 1,
        hi: BLOCKS,
        hashes: true,
        proposers: true,
      });
      const firstBlock = await db.query("SELECT total_gas::text, num_txs, jsonb_array_length(signed_by) AS signers FROM blocks WHERE height = 2");
      expect(firstBlock.rows[0]).toEqual({
        total_gas: String(150000 * 3 + 200000),
        num_txs: TXS_PER_BLOCK,
        signers: 3,
      });

      const txs = await db.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE NOT success)::int AS failed, count(DISTINCT height)::int AS heights FROM transactions");
      expect(txs.rows[0]).toEqual({
        n: BLOCKS * TXS_PER_BLOCK,
        failed: BLOCKS,
        heights: BLOCKS,
      });
      const failedTx = await db.query("SELECT error->>'@type' AS error_type, messages->0->>'@type' AS msg_type FROM transactions WHERE height = 5 AND index = 3");
      expect(failedTx.rows[0]).toEqual({
        error_type: "/std.InsufficientCoinsError",
        msg_type: "/vm.m_run",
      });

      const counts = await db.query("SELECT (SELECT count(*) FROM bank_sends)::int AS sends, (SELECT count(*) FROM vm_calls)::int AS calls, (SELECT count(*) FROM vm_add_packages)::int AS addpkgs, (SELECT count(*) FROM vm_runs)::int AS runs");
      expect(counts.rows[0]).toEqual({
        sends: BLOCKS,
        calls: BLOCKS,
        addpkgs: BLOCKS,
        runs: 0,
      });

      // One realm event per call and one storage event per deployment
      const events = await db.query("SELECT amino_type, count(*)::int AS n FROM gno_events GROUP BY amino_type ORDER BY amino_type");
      expect(events.rows).toEqual([
        {
          amino_type: "/tm.Event",
          n: BLOCKS,
        },
        {
          amino_type: "/tm.StorageDepositEvent",
          n: BLOCKS,
        },
      ]);
      const event = await db.query("SELECT phase, tx_index, type, pkg_path, attrs->0->>'value' AS count FROM gno_events WHERE height = 42 AND amino_type = '/tm.Event'");
      expect(event.rows[0]).toEqual({
        phase: "tx",
        tx_index: 1,
        type: "Incremented",
        pkg_path: Mocks.MOCK_REALM,
        count: "42",
      });

      // Every deployment from the chain plus the realm deployed at genesis, all with sources
      const packages = await db.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE from_genesis)::int AS genesis, count(*) FILTER (WHERE is_realm)::int AS realms FROM packages");
      expect(packages.rows[0]).toEqual({
        n: BLOCKS + 1,
        genesis: 1,
        realms: BLOCKS + 1,
      });
      const genesisPkg = await db.query("SELECT creator, height, genesis_block_height::int, timestamp, files_count FROM packages WHERE path = $1", [GENESIS_REALM]);
      expect(genesisPkg.rows[0]).toEqual({
        creator: Mocks.syntheticAddress(7),
        height: null,
        genesis_block_height: 4242,
        timestamp: new Date(1700000000000),
        files_count: 1,
      });
      const files = await db.query("SELECT count(*)::int AS n FROM package_files");
      expect(files.rows[0].n).toBe(BLOCKS + 1);

      // The set never changes: three validators, one history row each
      const validators = await db.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE active)::int AS active, max(last_seen_height)::int AS last_seen, min(first_seen_height)::int AS first_seen FROM validators");
      expect(validators.rows[0]).toEqual({
        n: 3,
        active: 3,
        last_seen: BLOCKS,
        first_seen: 1,
      });
      const history = await db.query("SELECT count(*)::int AS n FROM validator_power_history");
      expect(history.rows[0].n).toBe(3);

      // Blocks are one second apart in the mock, so every average is one second per block
      const blockTime = await db.query("SELECT average_time::float AS avg, height::int FROM average_block_time_per_minute");
      expect(blockTime.rows[0]).toEqual({
        avg: 1,
        height: 100,
      });

      const migrations = await db.query("SELECT module, version FROM schema_migrations ORDER BY module, version");
      expect(migrations.rows.map(r => `${r.module}@${r.version}`)).toEqual(["blocks-full@1", "gno.messages@1", "gno.packages@1", "gno.validators@1"]);

      const genesisImport = await db.query("SELECT status FROM genesis_import");
      expect(genesisImport.rows[0].status).toBe("complete");
    }
    finally {
      await db.end();
    }
  }, 120000);
});
