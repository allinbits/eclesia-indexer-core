import {
  EcleciaIndexer,
} from "@eclesia/indexer-engine";
import {
  Types, Utils,
} from "@eclesia/indexer-engine";
import {
  Client,
} from "pg";

export type PgIndexerConfig = {
  startHeight: number
  batchSize: number
  modules: string[]
  rpcUrl: string
  logLevel: "error" | "warn" | "info" | "http" | "verbose" | "debug" | "silly"
  usePolling: boolean
  processGenesis?: boolean
  pollingInterval: number
  minimal: boolean
  genesisPath?: string
  dbConnectionString: string
};

export class PgIndexer {
  private db!: Client;

  public modules: Record<string, Types.IndexingModule> = {
  };

  private instanceConnected: boolean = false;

  private config: PgIndexerConfig;

  public indexer: EcleciaIndexer;

  private clientReuse: number = 0;

  static withModules(config: PgIndexerConfig, modules: Types.IndexingModule[]) {
    const pgIndexer = new PgIndexer(config);
    pgIndexer.addModules(modules);
    return pgIndexer;
  }

  constructor(config: PgIndexerConfig, modules: Types.IndexingModule[] = []) {
    this.config = config;

    this.db = new Client(config.dbConnectionString);
    this.db.on("end", () => {
      this.indexer.log.warn("Database client disconnected");
      this.instanceConnected = false;
    },
    );
    this.db.on("error", (err) => {
      this.indexer.log.error("Error in db: " + err);
    });
    this.indexer = new EcleciaIndexer({
      ...config,
      getNextHeight: this.getNextHeight.bind(this),
      beginTransaction: this.beginTransaction.bind(this),
      endTransaction: this.endTransaction.bind(this),
    });
    this.indexer.log.info("Indexer instantiated");

    for (let i = 0; i < modules.length; i++) {
      this.indexer.log.verbose("Module " + modules[i].name + " initializing");
      modules[i].init(this);
      this.indexer.log.info("Module " + modules[i].name + " initialized");
      this.modules[modules[i].name] = modules[i];
    }
  }

  public addModules(modules: Types.IndexingModule[]) {
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
      if (!this.instanceConnected) {
        this.db = new Client(this.config.dbConnectionString);
        await this.db.connect();
        this.instanceConnected = true;
      }
      const res = await this.db.query("SELECT * FROM blocks ORDER BY height DESC LIMIT 1");
      if (res.rowCount != 0) {
        return Number(res.rows[0].height) + 1;
      }
      else {
        return this.config.startHeight;
      }
    }
    catch (e) {
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
    }
    catch (e) {
      this.indexer.log.error("Error beginning transaction: " + e);
      throw e;
    }
  }

  public async endTransaction(status: boolean) {
    try {
      if (status) {
        await this.db.query("COMMIT");
        this.indexer.log.silly("Transaction committed");
      }
      else {
        await this.db.query("ROLLBACK");
        this.indexer.log.silly("Transaction rolled back");
      }
    }
    catch (e) {
      this.indexer.log.error("Error ending transaction: " + e);
      throw e;
    }
    finally {
      this.clientReuse++;
      if (this.clientReuse >= 1500) {
        this.indexer.log.info("Recycling database client");
        await this.db.end();
        this.db = new Client(this.config.dbConnectionString);
        this.db.on("end", () => {
          this.instanceConnected = false;
        },
        );
        this.db.on("error", (err) => {
          this.indexer.log.error("Error in db: " + err);
        });
        await this.db.connect();
        this.instanceConnected = true;
        this.clientReuse = 0;
      }
    }
  }

  public getInstance(): Client {
    if (this.config.logLevel !== "silly") {
      return this.db;
    }
    else {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      return {
        ...self.db,
        query: async (...args: Parameters<Client["query"]>): Promise<ReturnType<Client["query"]>> => {
          const processStart = process.hrtime.bigint();
          const result = await self.db.query(...args);
          const processEnd = process.hrtime.bigint();
          const duration = Number(processEnd - processStart) / 1e6; // Convert to milliseconds
          self.indexer.log.silly(`Query executed in ${duration.toFixed(3)} ms: ${JSON.stringify(Utils.toPlainObject(args))}`);
          return result;
        },
      } as Client;
    }
  }
}
