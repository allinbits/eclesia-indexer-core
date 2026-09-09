import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  bench, describe,
} from "vitest";

import {
  EclesiaIndexer, Types,
} from "../src/index.js";

/**
 * Genesis import throughput: streams a synthetic genesis file through the same stream-json
 * pipeline the indexer uses at startup, with handlers that only count entries. Measures the
 * parser, the per-key re-read of the file, batching and event dispatch; no database is involved.
 */

const ACCOUNTS = 20000;

// Generated on first use rather than in a beforeAll hook: vitest's bench mode does not run
// the hooks before the first iteration. Removed when the process exits.
let genesisPath = "";
function syntheticGenesis(): string {
  if (!genesisPath) {
    genesisPath = writeSyntheticGenesis(ACCOUNTS);
    process.once("exit", () => {
      fs.rmSync(path.dirname(genesisPath), {
        recursive: true,
        force: true,
      });
    });
  }
  return genesisPath;
}

function writeSyntheticGenesis(accounts: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eclesia-genesis-bench-"));
  const file = path.join(dir, "genesis.json");
  const out = fs.openSync(file, "w");
  const address = (i: number) => "cosmos1" + i.toString(36).padStart(38, "q");
  fs.writeSync(out, "{\"chain_id\":\"bench-1\",\"app_state\":{\"auth\":{\"accounts\":[");
  for (let i = 0; i < accounts; i++) {
    fs.writeSync(out, (i ? "," : "") + JSON.stringify({
      "@type": "/cosmos.auth.v1beta1.BaseAccount",
      address: address(i),
      pub_key: null,
      account_number: String(i),
      sequence: "0",
    }));
  }
  fs.writeSync(out, "]},\"bank\":{\"balances\":[");
  for (let i = 0; i < accounts; i++) {
    fs.writeSync(out, (i ? "," : "") + JSON.stringify({
      address: address(i),
      coins: [
        {
          denom: "uatom",
          amount: String(1000000 + i),
        },
        {
          denom: "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
          amount: "42",
        },
      ],
    }));
  }
  fs.writeSync(out, "]},\"genutil\":{\"gen_txs\":[]}}}");
  fs.closeSync(out);
  return file;
}

function createGenesisIndexer(): EclesiaIndexer {
  const config: Types.EclesiaIndexerConfig = {
    rpcUrl: "http://mock-rpc:26657",
    batchSize: 10,
    modules: [],
    logLevel: "error",
    minimal: true,
    enableHealthcheck: false,
    enablePrometheus: false,
    genesisPath: syntheticGenesis(),
    getNextHeight: async () => 1,
    beginTransaction: async () => {},
    endTransaction: async () => {},
    shouldProcessGenesis: async () => true,
  };
  return new EclesiaIndexer(config);
}

describe.sequential("Genesis import (stream-json, no database)", () => {
  bench(`Import ${ACCOUNTS} accounts + ${ACCOUNTS} balances (2 array handlers)`, async () => {
    const indexer = createGenesisIndexer();
    let seen = 0;
    indexer.on("genesis/array/app_state.auth.accounts" as never, async (event: {
      value: unknown[]
    }) => {
      seen += event.value.length;
    });
    indexer.on("genesis/array/app_state.bank.balances" as never, async (event: {
      value: unknown[]
    }) => {
      seen += event.value.length;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (indexer as any).parseGenesis();
    if (seen !== ACCOUNTS * 2) {
      throw new Error("expected " + ACCOUNTS * 2 + " entries, saw " + seen);
    }
    await indexer.stop();
  }, {
    iterations: 5,
    warmupIterations: 2,
    time: 1,
  });

  bench(`Import ${ACCOUNTS} balances (1 array handler)`, async () => {
    const indexer = createGenesisIndexer();
    let seen = 0;
    indexer.on("genesis/array/app_state.bank.balances" as never, async (event: {
      value: unknown[]
    }) => {
      seen += event.value.length;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (indexer as any).parseGenesis();
    if (seen !== ACCOUNTS) {
      throw new Error("expected " + ACCOUNTS + " entries, saw " + seen);
    }
    await indexer.stop();
  }, {
    iterations: 5,
    warmupIterations: 2,
    time: 1,
  });
});
