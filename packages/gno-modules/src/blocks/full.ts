import * as path from "node:path";
import {
  fileURLToPath,
} from "node:url";

import {
  loadMigrations, PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  GnoAdapter, MessageDecoder, messageDecoders,
} from "@eclesia/chain-gno";
import {
  EclesiaIndexer, Types,
} from "@eclesia/indexer-engine";

import {
  decodeMessages, hexUpper, jsonStringify,
} from "../helpers.js";
import {
  BlockTimeAverages,
} from "./blocktime.js";

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type FullBlocksModuleOptions = {
  /** Extra or overriding message decoders by type URL, for forks with their own messages */
  decoders?: Record<string, MessageDecoder>
  /** Keep package source bodies inside `transactions.messages` (default: false, sizes only; the packages module stores sources) */
  includeFileBodies?: boolean
};

/**
 * Full blocks module for gno.land: stores every block with its proposer, gas and signatures,
 * every transaction with its decoded messages and execution result, and block-time averages.
 */
export class FullBlocksModule implements Types.IndexingModule<GnoAdapter> {
  indexer!: EclesiaIndexer<GnoAdapter>;

  private pgIndexer!: PgIndexer<GnoAdapter>;

  private blockTimes!: BlockTimeAverages;

  private readonly decoders: Record<string, MessageDecoder>;

  private readonly includeFileBodies: boolean;

  public name: string = "blocks-full";

  public depends: string[] = [];

  /** Provides both blocks and transactions data */
  public provides: string[] = ["blocks", "transactions"];

  constructor(options: FullBlocksModuleOptions = {
  }) {
    this.decoders = {
      ...messageDecoders,
      ...options.decoders,
    };
    this.includeFileBodies = options.includeFileBodies ?? false;
  }

  async setup() {
    await this.pgIndexer.applyMigrations(this.name, loadMigrations(path.join(__dirname, "sql", "full")), "blocks");
  }

  init(pgIndexer: PgIndexer<GnoAdapter>): void {
    this.pgIndexer = pgIndexer;
    this.indexer = pgIndexer.indexer;
    this.blockTimes = new BlockTimeAverages(pgIndexer);

    this.indexer.on("block", async (event): Promise<void> => {
      const block = event.value.block;
      const results = event.value.block_results.results.deliverTx ?? [];
      const db = this.pgIndexer.getInstance();

      const totalGas = results.reduce((gas, result) => gas + result.gasUsed, 0n);
      // Precommits in this block's last commit are for the previous block; null entries are absent votes
      const signedBy = (block.block.lastCommit?.precommits ?? [])
        .filter(vote => vote !== null)
        .map(vote => ({
          validator: vote.validatorAddress,
          round: vote.round,
        }));

      const endTimer = this.indexer.prometheus?.timeDatabaseQuery("add-block") ?? void 0;
      await db.query({
        name: "add-block",
        text: "INSERT INTO blocks(height, hash, num_txs, total_gas, proposer_address, timestamp, signed_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        values: [block.block.header.height, hexUpper(block.blockMeta.blockId.hash), block.block.txs.length, totalGas.toString(), block.block.header.proposerAddress, block.block.header.time, JSON.stringify(signedBy)],
      });
      endTimer?.();
    });

    this.indexer.on("tx", async (event): Promise<void> => {
      const tx = event.value;
      const db = this.pgIndexer.getInstance();
      const endTimer = this.indexer.prometheus?.timeDatabaseQuery("save-transaction") ?? void 0;
      await db.query({
        name: "add-tx",
        text: "INSERT INTO transactions(hash, height, index, success, messages, memo, signatures, fee, gas_wanted, gas_used, error, log, events, signers, session_address) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
        values: [
          tx.hash,
          event.height,
          tx.index,
          tx.success,
          jsonStringify(decodeMessages(tx.messages, this.decoders, this.includeFileBodies)),
          tx.memo,
          jsonStringify(tx.signatures),
          tx.fee
            ? JSON.stringify({
              gas_wanted: tx.fee.gasWanted.toString(),
              gas_fee: tx.fee.gasFee,
            })
            : "{}",
          tx.gasWanted.toString(),
          tx.gasUsed.toString(),
          tx.error ? JSON.stringify(tx.error) : null,
          // Null bytes are not valid in a text column
          // eslint-disable-next-line no-control-regex
          tx.log.replace(/\u0000/g, ""),
          jsonStringify(tx.events),
          tx.signers,
          tx.sessionAddress,
        ],
      });
      endTimer?.();
    });

    // Recompute block-time averages every 100 blocks
    this.indexer.on("periodic/medium", async (event) => {
      if (event.timestamp && event.height) {
        await this.blockTimes.update(event.height, event.timestamp);
      }
    });
  }
}
