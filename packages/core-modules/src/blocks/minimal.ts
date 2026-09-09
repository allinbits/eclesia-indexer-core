import * as path from "node:path";
import {
  fileURLToPath,
} from "node:url";

import {
  GeneratedType,
} from "@cosmjs/proto-signing";
import {
  loadMigrations, PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  EclesiaIndexer, Types,
} from "@eclesia/indexer-engine";
import {
  JSONStringify,
} from "json-with-bigint";

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Minimal blocks indexing module that stores only essential block data
 * Lighter alternative to FullBlocksModule for basic block tracking
 */
export class MinimalBlocksModule implements Types.IndexingModule {
  indexer!: EclesiaIndexer;

  private pgIndexer!: PgIndexer;

  /** Registry of protobuf message types (unused in minimal mode but required for interface) */
  private registry: [string, GeneratedType][];

  public name: string = "blocks-minimal";

  public depends: string[] = [];

  /** This module provides only basic blocks data */
  public provides: string[] = ["blocks"];

  constructor(registry: [string, GeneratedType][]) {
    this.registry = registry;
  }

  /**
   * Initializes minimal database schema for basic block tracking
   * Creates only essential blocks table without transaction details
   */
  async setup() {
    await this.pgIndexer.applyMigrations(this.name, loadMigrations(path.join(__dirname, "sql", "minimal")), "blocks");
  }

  /**
   * Initializes the minimal module with PostgreSQL indexer and sets up block event handler
   * @param pgIndexer - The PostgreSQL indexer instance
   */
  init(pgIndexer: PgIndexer): void {
    this.pgIndexer = pgIndexer;
    this.indexer = pgIndexer.indexer;

    // Build registry map (unused in minimal mode but maintained for consistency)
    const registryMap: Map<string, (typeof this.registry)[0][1]> = new Map();
    for (let i = 0; i < this.registry.length; i++) {
      registryMap.set(this.registry[i][0], this.registry[i][1]);
    }

    // Handle new blocks by storing only height and timestamp
    this.indexer.on("block", async (event): Promise<void> => {
      const block = event.value.block;
      const db = this.pgIndexer.getInstance();
      const endTimer = this.indexer.prometheus?.timeDatabaseQuery("add-block-minimal") ?? void 0;
      // Store minimal block data - only height and timestamp
      await db.query({
        name: "add-block-minimal",
        text: "INSERT INTO blocks(height, timestamp) VALUES ($1,$2)",
        values: [block.block.header.height, block.block.header.time],
      });
      endTimer?.();
      this.indexer.log.silly("Value passed to blocks indexing module: " + JSONStringify(event.value));
    });
  }
}
