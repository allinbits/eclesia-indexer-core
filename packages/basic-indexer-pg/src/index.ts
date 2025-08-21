import { EcleciaIndexer } from "@eclesia/indexer-engine";
import { IndexingModule } from "@eclesia/indexer-engine/dist/types";
import { Client } from "pg";

export type PgIndexerConfig = {
  startHeight: number;
  batchSize: number;
  modules: string[];
  rpcUrl: string;   
  logLevel: "error" | "warn" | "info" | "http" | "verbose" | "debug" | "silly";
  usePolling: boolean;
  processGenesis?: boolean;
  pollingInterval: number;
  minimal: boolean;
  genesisPath?: string;
  dbConnectionString: string;
};

export class PgIndexer {

  private db: Client;

  public modules: Record<string, IndexingModule> = {};

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

    this.db = new Client(config.dbConnectionString);
    this.db.on("end", () => {
      this.instanceConnected = false;
    }
    );
    this.indexer = new EcleciaIndexer({ ...config,
      getNextHeight: this.getNextHeight.bind(this),
      beginTransaction: this.beginTransaction.bind(this),
      endTransaction: this.endTransaction.bind(this) });
    this.indexer.log.info("Indexer instantiated");
    this.db.on("error", (err) => {
      this.indexer.log.error("Error in db: " + err);
    });
    for (let i = 0; i < modules.length; i++) {      
      this.indexer.log.verbose("Module " + modules[i].name + " initializing");
      modules[i].init(this);
      this.indexer.log.info("Module " + modules[i].name + " initialized");
      this.modules[modules[i].name] = modules[i];
    }
  }

  public addModules(modules: IndexingModule[]) {        
    for (let i = 0; i < modules.length; i++) {      
      this.indexer.log.verbose("Module " + modules[i].name + " initializing");
      modules[i].init(this);
      this.indexer.log.info("Module " + modules[i].name + " initialized");
      this.modules[modules[i].name] = modules[i];
    }
  }

  public async run() {
    await this.indexer.connect();
    await this.indexer.start();
  }

  async setup() {
    await this.indexer.connect();
    this.indexer.log.info("Connected to RPC");
    for (const indexingModule in this.modules) {
      this.indexer.log.verbose("Module " + indexingModule + " setting up");
      await this.modules[indexingModule].setup();
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
      this.indexer.log.silly("Transaction started");
    } catch (e) {
      this.indexer.log.error("Error beginning transaction: " + e);
      throw e;
    }
  }

  public async endTransaction(status: boolean) {
    try {
      if (status) {
        await this.db.query("COMMIT");
        this.indexer.log.silly("Transaction committed");
      } else {
        await this.db.query("ROLLBACK");
        this.indexer.log.silly("Transaction rolled back");
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