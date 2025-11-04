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
  TxData as TxData38,
} from "@cosmjs/tendermint-rpc/build/comet38/responses.js";
import {
  PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  EcleciaIndexer, Types,
} from "@eclesia/indexer-engine";
import {
  Utils, Validation,
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

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Full blocks indexing module that stores complete block and transaction data
 * including gas usage, signatures, messages, and performance metrics
 */
export class FullBlocksModule implements Types.IndexingModule {
  indexer!: EcleciaIndexer;

  private pgIndexer!: PgIndexer;

  /** Registry of protobuf message types for decoding transaction messages */
  private registry: [string, GeneratedType][];

  public name: string = "blocks-full";

  public depends: string[] = [];

  /** This module provides both blocks and transactions data */
  public provides: string[] = ["blocks", "transactions"];

  /** Validated chain prefix for address generation */
  private chainPrefix: string;

  constructor(registry: [string, GeneratedType][]) {
    this.registry = registry;
    // Validate and cache chain prefix at initialization
    this.chainPrefix = Validation.getChainPrefix("cosmos");
  }

  /**
   * Initializes the database schema if it doesn't exist
   * Creates tables for blocks, transactions, and block time averages
   */
  async setup() {
    await this.pgIndexer.beginTransaction();
    const client = this.pgIndexer.getInstance();

    // Check if the blocks table already exists
    const exists = await client.query(
      "SELECT EXISTS ( SELECT FROM pg_tables WHERE  schemaname = 'public' AND tablename  = 'blocks')",
    );

    if (!exists.rows[0].exists) {
      this.indexer.log.warn("Database not configured");
      // Load and execute the full schema SQL file
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

  /**
   * Initializes the module with PostgreSQL indexer and sets up event handlers
   * @param pgIndexer - The PostgreSQL indexer instance
   */
  init(pgIndexer: PgIndexer): void {
    this.pgIndexer = pgIndexer;
    this.indexer = pgIndexer.indexer;

    // Build a map of protobuf message types for efficient lookup during message decoding
    const registryMap: Map<string, (typeof this.registry)[0][1]> = new Map();
    for (let i = 0; i < this.registry.length; i++) {
      registryMap.set(this.registry[i][0], this.registry[i][1]);
    }

    // Handle new blocks by storing block metadata and processing all transactions
    this.indexer.on("block", async (event): Promise<void> => {
      const block = event.value.block;
      const block_results = event.value.block_results;
      const db = this.pgIndexer.getInstance();

      // Insert block data with comprehensive metadata
      await db.query({
        name: "add-block",
        text: "INSERT INTO blocks(height,hash,num_txs,total_gas, proposer_address, timestamp,signed_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        values: [
          block.block.header.height,
          Buffer.from(block.blockId.hash).toString("hex"),
          block.block.txs.length,
          calculateGas(block_results).toString(),
          // Convert proposer address to bech32 format with validator consensus prefix
          Utils.chainAddressfromKeyhash(
            this.chainPrefix + "valcons", Buffer.from(block.block.header.proposerAddress).toString("hex"),
          ),
          block.block.header.time,
          // Store validator signatures in structured JSON format
          JSONStringify(block.block.lastCommit?.signatures.map((x) => {
            return {
              validator: Utils.chainAddressfromKeyhash(
                this.chainPrefix + "valcons", Buffer.from(x.validatorAddress ?? new Uint8Array()).toString("hex"),
              ),
              block_id: x.blockIdFlag,
            };
          }) ?? []),
        ],
      });
      // Process each transaction in the block
      for (let i = 0; i < block.block.txs.length; i++) {
        const txraw = block.block.txs[i];
        const tx = Tx.decode(txraw);
        // Calculate SHA-256 hash of the raw transaction bytes
        const txHash = createHash("sha256").update(txraw).digest("hex");
        if (event.height) {
          await this.saveTransaction(txHash, event.height, tx, block_results.results[i], registryMap);
        }
      }
      this.indexer.log.silly("Value passed to blocks indexing module: " + JSONStringify(event.value));
    });

    // Calculate and store average block times every 100 blocks
    this.indexer.on("periodic/100", async (event) => {
      if (event.timestamp && event.height) {
        const dt = new Date(event.timestamp);

        // Calculate average block time over the last minute
        const blockMinAgo = await this.getBlockHeightTimeMinuteAgo(event.timestamp);
        if (blockMinAgo) {
          const blockTimeMinute
            = (event.height - blockMinAgo.height) * 1000
              / (dt.getTime() - new Date(blockMinAgo.timestamp).getTime());
          await this.updateBlockTimeMinuteAgo(1 / blockTimeMinute, event.height);
        }

        // Calculate average block time over the last hour
        const blockHourAgo = await this.getBlockHeightTimeHourAgo(event.timestamp);
        if (blockHourAgo) {
          const blockTimeHour
            = (event.height - blockHourAgo.height) * 1000
              / (dt.getTime() - new Date(blockHourAgo.timestamp).getTime());
          await this.updateBlockTimeHourAgo(1 / blockTimeHour, event.height);
        }

        // Calculate average block time over the last day
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

  /**
   * Retrieves the most recent block at or before a given timestamp
   * @param dt - The target date/time
   * @returns Block data or null if no block found
   */
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

  /**
   * Gets the block that was created approximately one minute ago
   * @param dt - Current timestamp string
   * @returns Block data or null
   */
  async getBlockHeightTimeMinuteAgo(dt: string) {
    const date = new Date(dt);
    const aMinuteAgo = new Date(date.getTime() - 60 * 1000);

    return await this.getBlockHeightTime(aMinuteAgo);
  }

  /**
   * Gets the block that was created approximately one hour ago
   * @param dt - Current timestamp string
   * @returns Block data or null
   */
  async getBlockHeightTimeHourAgo(dt: string) {
    const date = new Date(dt);
    const anHourAgo = new Date(date.getTime() - 60 * 60 * 1000);

    return await this.getBlockHeightTime(anHourAgo);
  }

  /**
   * Gets the block that was created approximately one day ago
   * @param dt - Current timestamp string
   * @returns Block data or null
   */
  async getBlockHeightTimeDayAgo(dt: string) {
    const date = new Date(dt);
    const aDayAgo = new Date(date.getTime() - 24 * 60 * 60 * 1000);

    return await this.getBlockHeightTime(aDayAgo);
  }

  /**
   * Updates the average block time calculated over the last minute
   * Uses upsert pattern to maintain single row with latest data
   * @param blocktime - Average time between blocks in seconds
   * @param height - Current block height
   */
  async updateBlockTimeMinuteAgo(blocktime: number, height: number) {
    const db = this.pgIndexer.getInstance();
    await db.query(
      "INSERT INTO average_block_time_per_minute(average_time, height) VALUES ($1, $2) ON CONFLICT (one_row_id) DO UPDATE SET average_time = excluded.average_time, height = excluded.height WHERE average_block_time_per_minute.height <= excluded.height", [blocktime, height],
    );
  }

  /**
   * Updates the average block time calculated over the last hour
   * Uses upsert pattern to maintain single row with latest data
   * @param blocktime - Average time between blocks in seconds
   * @param height - Current block height
   */
  async updateBlockTimeHourAgo(blocktime: number, height: number) {
    const db = this.pgIndexer.getInstance();
    await db.query(
      "INSERT INTO average_block_time_per_hour(average_time, height) VALUES ($1, $2) ON CONFLICT (one_row_id) DO UPDATE SET average_time = excluded.average_time, height = excluded.height WHERE average_block_time_per_hour.height <= excluded.height", [blocktime, height],
    );
  }

  /**
   * Updates the average block time calculated over the last day
   * Uses upsert pattern to maintain single row with latest data
   * @param blocktime - Average time between blocks in seconds
   * @param height - Current block height
   */
  async updateBlockTimeDayAgo(blocktime: number, height: number) {
    const db = this.pgIndexer.getInstance();
    await db.query(
      "INSERT INTO average_block_time_per_day(average_time, height) VALUES ($1, $2) ON CONFLICT (one_row_id) DO UPDATE SET average_time = excluded.average_time, height = excluded.height WHERE average_block_time_per_day.height <= excluded.height", [blocktime, height],
    );
  }

  /**
   * Saves a decoded transaction to the database with full metadata
   * @param txHash - SHA-256 hash of the transaction
   * @param height - Block height containing this transaction
   * @param tx - Decoded transaction object
   * @param txdata - Transaction execution results
   * @param registryMap - Map of protobuf types for message decoding
   */
  async saveTransaction(
    txHash: string,
    height: number,
    tx: Tx,
    txdata: TxData | TxData38,
    registryMap: Map<string, GeneratedType>,
  ) {
    const db = this.pgIndexer.getInstance();
    await db.query({
      name: "add-tx",
      text: "INSERT INTO transactions(hash,height,success,messages,memo,signatures,signer_infos,fee,gas_wanted,gas_used,raw_log,logs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      values: [
        txHash.toUpperCase(),
        height,
        txdata.code == 0, // Transaction success is determined by code == 0
        JSONStringify(
          tx.body?.messages.map((x) => {
            // Attempt to decode message using registered protobuf types
            const msgtype = registryMap.get(x.typeUrl);
            if (msgtype) {
              const msg = msgtype?.decode(x.value);
              msg["@type"] = x.typeUrl; // Add type URL for message identification

              return msg;
            }
            else {
              // Return raw message if no decoder available
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
        // Remove null bytes from log string to prevent database issues
        // eslint-disable-next-line no-control-regex
        txdata.log?.replace(/\u0000/g, ""),
        JSON.stringify(Utils.toPlainObject(txdata.events)),
      ],
    });
  }
}
