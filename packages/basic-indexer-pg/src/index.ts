import { EcleciaIndexer } from "@clockwork-projects/indexer-engine";
import { IndexingModule } from "@clockwork-projects/indexer-engine/dist/types";
import { Client } from "pg";

export type PgIndexerConfig = {
  startHeight: number;
  batchSize: number;
  modules: string[];
  rpcUrl: string;   
  logLevel: "error" | "warn" | "info" | "http" | "verbose" | "debug" | "silly";
  usePolling: boolean;
  pollingInterval: number;
  minimal: boolean;
  dbConnectionString: string;
};

export class PgIndexer {

  private db: Client;

  private modules: IndexingModule[] = [];

  private config: PgIndexerConfig;

  private instanceConnected: boolean = false;

  public indexer: EcleciaIndexer;

  static withModules(config: PgIndexerConfig, modules: IndexingModule[]) {
    const pgIndexer = new PgIndexer(config);
    pgIndexer.addModules(modules);
    return pgIndexer;
  }

  constructor(config: PgIndexerConfig, modules: IndexingModule[] = []) {
    this.config = config;
    this.modules = modules;

    this.db = new Client(config.dbConnectionString);
    this.db.on("end", () => {
      this.instanceConnected = false;
    }
    );
    this.indexer = new EcleciaIndexer({ ...config,
      getNextHeight: this.getNextHeight.bind(this),
      beginTransaction: this.beginTransaction.bind(this),
      endTransaction: this.endTransaction.bind(this) });
    this.db.on("error", (err) => {
      this.indexer.log.error("Error in db: " + err);
    });

    for (let i = 0; i < this.modules.length; i++) {
      this.modules[i].init(this);
    }
  }

  public addModules(modules: IndexingModule[]) {
    this.modules = modules;
    for (let i = 0; i < this.modules.length; i++) {
      this.modules[i].init();
    }
  }

  public async run() {
    await this.indexer.connect();
    await this.indexer.start();
  }

  async setup() {
    await this.indexer.connect();
    for (let i = 0; i < this.modules.length; i++) {
      await this.modules[i].setup();
    }
  }

  public async getNextHeight() {
    try {
      const res = await this.db.query("SELECT * FROM blocks ORDER BY height DESC LIMIT 1");
      if (res.rowCount != 0) {
        return Number(res.rows[0].height) + 1;
      } else {
        return this.config.startHeight;
      } 
    } catch (e) {
      this.indexer.log.error("Error fetching latest height processed: " + e);
      throw e;
    }
  }

  public async beginTransaction() {
    try {
      if (!this.instanceConnected) {
        await this.db.connect();
        this.instanceConnected = true;
      }
      await this.db.query("BEGIN");
    } catch (e) {
      this.indexer.log.error("Error beginning transaction: " + e);
      throw e;
    }
  }

  public async endTransaction(status: boolean) {
    try {
      if (status) {
        await this.db.query("COMMIT");
      } else {
        await this.db.query("ROLLBACK");
      }
    } catch (e) {
      this.indexer.log.error("Error ending transaction: " + e);
      throw e;
    }
  }

  public getInstance() {
    return this.db;
  }
}