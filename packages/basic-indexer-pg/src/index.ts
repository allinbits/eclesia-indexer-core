/* eslint-disable @stylistic/no-multi-spaces */
import {
  EcleciaIndexer,
} from "@eclesia/indexer-engine";
import {
  Types, Utils,
} from "@eclesia/indexer-engine";
import {
  Client,
} from "pg";

/** Configuration options for the PostgreSQL indexer */
export type PgIndexerConfig = {
  startHeight: number                        // Block height to start indexing from
  batchSize: number                          // Number of blocks to keep pre-fetched when syncing
  modules: string[]                          // List of module names to enable
  rpcUrl: string                             // Tendermint RPC endpoint URL
  logLevel: "error" | "warn" | "info" | "http" | "verbose" | "debug" | "silly" // Logging verbosity
  usePolling: boolean                        // Whether to use polling vs WebSocket subscription
  processGenesis?: boolean                   // Whether to process genesis state
  pollingInterval: number                    // Interval between polls (ms) when using polling
  minimal: boolean                           // Whether to use minimal indexing (blocks only)
  genesisPath?: string                       // Path to genesis file for processing
  dbConnectionString: string                 // PostgreSQL connection string
};

/**
 * PostgreSQL-based blockchain indexer that orchestrates data collection and storage
 * Manages database connections, transactions, and indexing modules
 */
export class PgIndexer {
  /** PostgreSQL client instance */
  private db!: Client;

  /** Registry of active indexing modules */
  public modules: Record<string, Types.IndexingModule> = {
  };

  /** Database connection status flag */
  private instanceConnected: boolean = false;

  /** Indexer configuration */
  private config: PgIndexerConfig;

  /** Core indexer engine instance */
  public indexer: EcleciaIndexer;

  /** Counter for database client recycling to prevent connection issues */
  private clientReuse: number = 0;

  /**
   * Factory method to create a PgIndexer instance with modules
   * @param config - Indexer configuration
   * @param modules - Array of indexing modules to install
   * @returns Configured PgIndexer instance
   */
  static withModules(config: PgIndexerConfig, modules: Types.IndexingModule[]) {
    const pgIndexer = new PgIndexer(config);
    pgIndexer.addModules(modules);
    return pgIndexer;
  }

  /**
   * Creates a new PostgreSQL indexer instance
   * @param config - Indexer configuration
   * @param modules - Optional array of indexing modules to install immediately
   */
  constructor(config: PgIndexerConfig, modules: Types.IndexingModule[] = []) {
    this.config = config;

    // Initialize PostgreSQL client with connection string
    this.db = new Client(config.dbConnectionString);
    this.db.on("end", () => {
      this.indexer.log.warn("Database client disconnected");
      this.instanceConnected = false;
    },
    );
    this.db.on("error", (err) => {
      this.indexer.log.error("Error in db: " + err);
    });

    // Initialize core indexer engine with database callbacks
    this.indexer = new EcleciaIndexer({
      ...config,
      getNextHeight: this.getNextHeight.bind(this),
      beginTransaction: this.beginTransaction.bind(this),
      endTransaction: this.endTransaction.bind(this),
      shouldProcessGenesis: this.shouldProcessGenesis.bind(this),
    });
    this.indexer.log.info("Indexer instantiated");

    // Initialize any modules provided in constructor
    for (let i = 0; i < modules.length; i++) {
      this.indexer.log.verbose("Module " + modules[i].name + " initializing");
      modules[i].init(this);
      this.indexer.log.info("Module " + modules[i].name + " initialized");
      this.modules[modules[i].name] = modules[i];
    }
  }

  /**
   * Adds indexing modules to the running indexer
   * @param modules - Array of indexing modules to add
   */
  public addModules(modules: Types.IndexingModule[]) {
    for (let i = 0; i < modules.length; i++) {
      this.indexer.log.verbose("Module " + modules[i].name + " initializing");
      modules[i].init(this);
      this.indexer.log.info("Module " + modules[i].name + " initialized");
      this.modules[modules[i].name] = modules[i];
    }
  }

  /**
   * Starts the indexer by connecting to RPC and beginning block processing
   */
  public async run() {
    const connected = await this.indexer.connect();
    if (!connected) {
      throw new Error("Could not connect to RPC");
    }
    this.indexer.log.info("Connected to RPC");
    await this.indexer.start();
  }

  /**
   * Sets up the indexer by connecting to RPC and initializing all modules
   * This should be called before run() to ensure proper database schema setup
   */
  async setup() {
    const connected = await this.indexer.connect();
    if (!connected) {
      throw new Error("Could not connect to RPC");
    }
    this.indexer.log.info("Connected to RPC");
    // Initialize database schemas for all modules
    for (const indexingModule in this.modules) {
      this.indexer.log.verbose("Module " + indexingModule + " setting up");
      await this.modules[indexingModule].setup();
    }
  }

  /**
   * Determines the next block height to process by querying the database
   * Returns the configured start height if no blocks are found in the database
   * @returns The next block height to process
   */
  public async getNextHeight() {
    try {
      // Ensure database connection is active
      if (!this.instanceConnected) {
        this.db = new Client(this.config.dbConnectionString);
        await this.db.connect();
        this.instanceConnected = true;
      }

      // Query for the highest block height in the database
      const res = await this.db.query("SELECT * FROM blocks ORDER BY height DESC LIMIT 1");
      if (res.rowCount != 0) {
        return Number(res.rows[0].height) + 1;
      }
      else {
        // No blocks found, start from configured height
        return this.config.startHeight;
      }
    }
    catch (e) {
      this.indexer.log.error("Error fetching latest height processed: " + e);
      throw e;
    }
  }

  /**
   * Determines the next block height to process by querying the database
   * Returns the configured start height if no blocks are found in the database
   * @returns The next block height to process
   */
  public async shouldProcessGenesis() {
    if (!this.config.processGenesis) {
      return false;
    }
    try {
      // Ensure database connection is active
      if (!this.instanceConnected) {
        this.db = new Client(this.config.dbConnectionString);
        await this.db.connect();
        this.instanceConnected = true;
      }

      // Query for the highest block height in the database
      const res = await this.db.query("SELECT * FROM blocks ORDER BY height DESC LIMIT 1");
      if (res.rowCount != 0) {
        return false;
      }
      else {
        if (this.config.startHeight === 1) {
          return true;
        }
        else {
          return false;
        }
      }
    }
    catch (e) {
      this.indexer.log.error("Error deciding whether to process genesis: " + e);
      throw e;
    }
  }

  /**
   * Begins a PostgreSQL transaction for atomic block processing
   * Ensures database connection is active before starting transaction
   */
  public async beginTransaction() {
    try {
      // Ensure database connection is active
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

  /**
   * Ends a PostgreSQL transaction by committing or rolling back
   * Includes database client recycling to prevent connection issues
   * @param status - true to commit, false to rollback
   */
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
      // Database client recycling to prevent long-running connection issues
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

  /**
   * Returns a PostgreSQL client instance with optional query timing
   * When log level is 'silly', wraps queries with performance monitoring
   * @returns PostgreSQL client instance
   */
  public getInstance(): Client {
    if (this.config.logLevel !== "silly") {
      return this.db;
    }
    else {
      // Create a proxy client that logs query performance
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
