import fs from "node:fs";

import { PgIndexer } from "@clockwork-projects/basic-pg-indexer";
import { EcleciaIndexer, Types } from "@clockwork-projects/indexer-engine";
import { GeneratedType } from "@cosmjs/proto-signing";
import JSONbig from "json-bigint";

export class MinimalBlocksModule implements Types.IndexingModule {
  indexer!: EcleciaIndexer;

  private pgIndexer!: PgIndexer;

  private registry: [string, GeneratedType][];

  public name: string = "blocks-minimal";

  public depends: string[] = [];

  public provides: string[] = ["blocks"];

  constructor(registry: [string, GeneratedType][]) {
    this.registry = registry;
  }

  async setup() {

    await this.pgIndexer.beginTransaction();
    const client = this.pgIndexer.getInstance();          
    const exists = await client.query(
      "SELECT EXISTS ( SELECT FROM pg_tables WHERE  schemaname = 'public' AND tablename  = 'blocks')"
    );
    if (!exists.rows[0].exists) {
      this.indexer.log.warn("Database not configured");    
      const base = fs.readFileSync(__dirname + "/./sql/minimal.sql").toString();
      try {
        await client.query(base);
        this.indexer.log.info("DB has been set up");
        this.pgIndexer.endTransaction(true);
      } catch (e) {
        this.pgIndexer.endTransaction(false);
        throw new Error("" + e);
      } 
    } else {
      this.pgIndexer.endTransaction(true);
    }
  }

  init(pgIndexer: PgIndexer): void {

    this.pgIndexer = pgIndexer;
    this.indexer = pgIndexer.indexer;
    const registryMap: Map<string, (typeof this.registry)[0][1]> = new Map();
    for (let i = 0; i < this.registry.length; i++) {
      registryMap.set(this.registry[i][0], this.registry[i][1]);
    }
  
    this.indexer.on("block", async(event): Promise<void> => {
      const block = event.value.block;
      const db = this.pgIndexer.getInstance();
      db.query({
        name: "add-block",
        text: "INSERT INTO blocks(height, timestamp) VALUES ($1,$2)",
        values: [
          block.block.header.height,
          block.block.header.time
        ]
      });
      this.indexer.log.silly("Value passed to blocks indexing module: " + JSONbig.stringify(event.value));
    
    });
  }
}
