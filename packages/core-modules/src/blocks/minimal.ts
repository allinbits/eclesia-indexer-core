import * as fs from "node:fs";
import * as path from "node:path";
import {
  fileURLToPath,
} from "node:url";

import {
  GeneratedType,
} from "@cosmjs/proto-signing";
import {
  PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  EcleciaIndexer, Types,
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
  indexer!: EcleciaIndexer;

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
    await this.pgIndexer.beginTransaction();
    const client = this.pgIndexer.getInstance();

    // Check if the blocks table already exists
    const exists = await client.query(
      "SELECT EXISTS ( SELECT FROM pg_tables WHERE  schemaname = 'public' AND tablename  = 'blocks')",
    );

    if (!exists.rows[0].exists) {
      this.indexer.log.warn("Database not configured");
      // Load and execute the minimal schema SQL file
      const base = fs.readFileSync(__dirname + "/./sql/minimal.sql").toString();
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
      // Store minimal block data - only height and timestamp
      db.query({
        name: "add-block",
        text: "INSERT INTO blocks(height, timestamp) VALUES ($1,$2)",
        values: [block.block.header.height, block.block.header.time],
      });
      this.indexer.log.silly("Value passed to blocks indexing module: " + JSONStringify(event.value));
    });
  }
}
