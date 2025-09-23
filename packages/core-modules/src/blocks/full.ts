import {
  createHash,
} from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  fileURLToPath,
} from "node:url";

import {
  GeneratedType,
} from "@cosmjs/proto-signing";
import {
  TxData,
} from "@cosmjs/tendermint-rpc";
import {
  PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  EcleciaIndexer, Types,
} from "@eclesia/indexer-engine";
import {
  Utils,
} from "@eclesia/indexer-engine";
import {
  Tx,
} from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import {
  JSONStringify,
} from "json-with-bigint";

import {
  calculateGas,
} from "./helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class FullBlocksModule implements Types.IndexingModule {
  indexer!: EcleciaIndexer;

  private pgIndexer!: PgIndexer;

  private registry: [string, GeneratedType][];

  public name: string = "blocks-full";

  public depends: string[] = [];

  public provides: string[] = ["blocks", "transactions"];

  constructor(registry: [string, GeneratedType][]) {
    this.registry = registry;
  }

  async setup() {
    await this.pgIndexer.beginTransaction();
    const client = this.pgIndexer.getInstance();
    const exists = await client.query(
      "SELECT EXISTS ( SELECT FROM pg_tables WHERE  schemaname = 'public' AND tablename  = 'blocks')",
    );
    if (!exists.rows[0].exists) {
      this.indexer.log.warn("Database not configured");
      const base = fs.readFileSync(__dirname + "/./sql/full.sql").toString();
      try {
        await client.query(base);
        this.indexer.log.info("DB has been set up");
        await this.pgIndexer.endTransaction(true);
      }
      catch (e) {
        await this.pgIndexer.endTransaction(false);
        throw new Error("" + e);
      }
    }
    else {
      await this.pgIndexer.endTransaction(true);
    }
  }

  init(pgIndexer: PgIndexer): void {
    this.pgIndexer = pgIndexer;
    this.indexer = pgIndexer.indexer;
    const registryMap: Map<string, (typeof this.registry)[0][1]> = new Map();
    for (let i = 0; i < this.registry.length; i++) {
      registryMap.set(this.registry[i][0], this.registry[i][1]);
    }

    this.indexer.on("block", async (event): Promise<void> => {
      const block = event.value.block;
      const block_results = event.value.block_results;
      const db = this.pgIndexer.getInstance();
      await db.query({
        name: "add-block",
        text: "INSERT INTO blocks(height,hash,num_txs,total_gas, proposer_address, timestamp,signed_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        values: [
          block.block.header.height,
          Buffer.from(block.blockId.hash).toString("hex"),
          block.block.txs.length,
          calculateGas(block_results).toString(),
          Utils.chainAddressfromKeyhash(
            (process.env.CHAIN_PREFIX ?? "cosmos") + "valcons", Buffer.from(block.block.header.proposerAddress).toString("hex"),
          ),
          block.block.header.time,
          JSONStringify(block.block.lastCommit?.signatures.map((x) => {
            return {
              validator: Utils.chainAddressfromKeyhash(
                (process.env.CHAIN_PREFIX ?? "cosmos") + "valcons", Buffer.from(x.validatorAddress ?? new Uint8Array()).toString("hex"),
              ),
              block_id: x.blockIdFlag,
            };
          }) ?? []),
        ],
      });
      for (let i = 0; i < block.block.txs.length; i++) {
        const txraw = block.block.txs[i];
        const tx = Tx.decode(txraw);
        const txHash = createHash("sha256").update(txraw).digest("hex");
        if (event.height) {
          await this.saveTransaction(txHash, event.height, tx, block_results.results[i], registryMap);
        }
      }
      this.indexer.log.silly("Value passed to blocks indexing module: " + JSONStringify(event.value));
    });

    this.indexer.on("periodic/100", async (event) => {
      if (event.timestamp && event.height) {
        const dt = new Date(event.timestamp);
        const blockMinAgo = await this.getBlockHeightTimeMinuteAgo(event.timestamp);
        if (blockMinAgo) {
          const blockTimeMinute
            = (event.height - blockMinAgo.height) * 1000
              / (dt.getTime() - new Date(blockMinAgo.timestamp).getTime());
          await this.updateBlockTimeMinuteAgo(1 / blockTimeMinute, event.height);
        }
        const blockHourAgo = await this.getBlockHeightTimeHourAgo(event.timestamp);
        if (blockHourAgo) {
          const blockTimeHour
            = (event.height - blockHourAgo.height) * 1000
              / (dt.getTime() - new Date(blockHourAgo.timestamp).getTime());
          await this.updateBlockTimeHourAgo(1 / blockTimeHour, event.height);
        }
        const blockDayAgo = await this.getBlockHeightTimeDayAgo(event.timestamp);
        if (blockDayAgo) {
          const blockTimeDay
            = (event.height - blockDayAgo.height) * 1000
              / (dt.getTime() - new Date(blockDayAgo.timestamp).getTime());
          await this.updateBlockTimeDayAgo(1 / blockTimeDay, event.height);
        }
      }
    });
  }

  async getBlockHeightTime(dt: Date) {
    const db = this.pgIndexer.getInstance();
    const block = await db.query(
      "SELECT * FROM blocks WHERE blocks.timestamp <= $1 ORDER BY blocks.timestamp DESC LIMIT 1;", [dt],
    );
    if (block.rowCount && block.rowCount > 0) {
      return block.rows[0];
    }
    else {
      return null;
    }
  }

  async getBlockHeightTimeMinuteAgo(dt: string) {
    const date = new Date(dt);
    const aMinuteAgo = new Date(date.getTime() - 60 * 1000);

    return await this.getBlockHeightTime(aMinuteAgo);
  }

  async getBlockHeightTimeHourAgo(dt: string) {
    const date = new Date(dt);
    const anHourAgo = new Date(date.getTime() - 60 * 60 * 1000);

    return await this.getBlockHeightTime(anHourAgo);
  }

  async getBlockHeightTimeDayAgo(dt: string) {
    const date = new Date(dt);
    const aDayAgo = new Date(date.getTime() - 24 * 60 * 60 * 1000);

    return await this.getBlockHeightTime(aDayAgo);
  }

  async updateBlockTimeMinuteAgo(blocktime: number, height: number) {
    const db = this.pgIndexer.getInstance();
    await db.query(
      "INSERT INTO average_block_time_per_minute(average_time, height) VALUES ($1, $2) ON CONFLICT (one_row_id) DO UPDATE SET average_time = excluded.average_time, height = excluded.height WHERE average_block_time_per_minute.height <= excluded.height", [blocktime, height],
    );
  }

  async updateBlockTimeHourAgo(blocktime: number, height: number) {
    const db = this.pgIndexer.getInstance();
    await db.query(
      "INSERT INTO average_block_time_per_hour(average_time, height) VALUES ($1, $2) ON CONFLICT (one_row_id) DO UPDATE SET average_time = excluded.average_time, height = excluded.height WHERE average_block_time_per_hour.height <= excluded.height", [blocktime, height],
    );
  }

  async updateBlockTimeDayAgo(blocktime: number, height: number) {
    const db = this.pgIndexer.getInstance();
    await db.query(
      "INSERT INTO average_block_time_per_day(average_time, height) VALUES ($1, $2) ON CONFLICT (one_row_id) DO UPDATE SET average_time = excluded.average_time, height = excluded.height WHERE average_block_time_per_day.height <= excluded.height", [blocktime, height],
    );
  }

  async saveTransaction(
    txHash: string,
    height: number,
    tx: Tx,
    txdata: TxData,
    registryMap: Map<string, GeneratedType>,
  ) {
    const db = this.pgIndexer.getInstance();
    await db.query({
      name: "add-tx",
      text: "INSERT INTO transactions(hash,height,success,messages,memo,signatures,signer_infos,fee,gas_wanted,gas_used,raw_log,logs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      values: [
        txHash.toUpperCase(),
        height,
        txdata.code == 0,
        JSONStringify(
          tx.body?.messages.map((x) => {
            const msgtype = registryMap.get(x.typeUrl);
            if (msgtype) {
              const msg = msgtype?.decode(x.value);
              msg["@type"] = x.typeUrl;

              return msg;
            }
            else {
              return x;
            }
          }),
        ),
        tx.body?.memo,
        tx.signatures,
        JSON.stringify(Utils.toPlainObject(tx.authInfo?.signerInfos)),
        JSON.stringify(Utils.toPlainObject(tx.authInfo?.fee)),
        txdata.gasWanted,
        txdata.gasUsed,
        // eslint-disable-next-line no-control-regex
        txdata.log?.replace(/\u0000/g, ""),
        JSON.stringify(Utils.toPlainObject(txdata.events)),
      ],
    });
  }
}
