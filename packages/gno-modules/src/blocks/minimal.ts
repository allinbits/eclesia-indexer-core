import * as path from "node:path";
import {
  fileURLToPath,
} from "node:url";

import {
  loadMigrations, PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  GnoAdapter,
} from "@eclesia/chain-gno";
import {
  EclesiaIndexer, Types,
} from "@eclesia/indexer-engine";

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Minimal blocks module for gno.land: stores only heights and block times, which is all the
 * PostgreSQL indexer needs to resume, so lighter modules can build on it.
 */
export class MinimalBlocksModule implements Types.IndexingModule<GnoAdapter> {
  indexer!: EclesiaIndexer<GnoAdapter>;

  private pgIndexer!: PgIndexer<GnoAdapter>;

  public name: string = "blocks-minimal";

  public depends: string[] = [];

  public provides: string[] = ["blocks"];

  async setup() {
    await this.pgIndexer.applyMigrations(this.name, loadMigrations(path.join(__dirname, "sql", "minimal")), "blocks");
  }

  init(pgIndexer: PgIndexer<GnoAdapter>): void {
    this.pgIndexer = pgIndexer;
    this.indexer = pgIndexer.indexer;

    this.indexer.on("block", async (event): Promise<void> => {
      const header = event.value.block.block.header;
      const db = this.pgIndexer.getInstance();
      const endTimer = this.indexer.prometheus?.timeDatabaseQuery("add-block-minimal") ?? void 0;
      await db.query({
        name: "add-block-minimal",
        text: "INSERT INTO blocks(height, timestamp) VALUES ($1,$2)",
        values: [header.height, header.time],
      });
      endTimer?.();
    });
  }
}
