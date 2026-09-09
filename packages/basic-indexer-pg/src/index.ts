/* eslint-disable @stylistic/no-multi-spaces */
import * as fs from "node:fs";
import * as path from "node:path";

import {
  ConfigurationError, DB_CLIENT_RECYCLE_COUNT, DEFAULT_START_HEIGHT, EclesiaIndexer, Types, Utils,
} from "@eclesia/indexer-engine";
import {
  Client,
} from "pg";

/** One schema migration for a module; applied once, in ascending version order */
export type Migration = {
  version: number   // Positive, unique per module
  name: string      // Human-readable label, recorded in schema_migrations
  sql: string       // Statements run inside one transaction
};

/**
 * Loads migrations from a directory of `NNN_name.sql` files (for example `001_initial.sql`),
 * ordered by their numeric prefix. Files without a numeric prefix are ignored.
 * @param dir - Directory containing the SQL files
 */
export function loadMigrations(dir: string): Migration[] {
  const migrations: Migration[] = [];
  for (const file of fs.readdirSync(dir)) {
    const match = /^(\d+)_(.+)\.sql$/.exec(file);
    if (!match) {
      continue;
    }
    migrations.push({
      version: parseInt(match[1], 10),
      name: match[2],
      sql: fs.readFileSync(path.join(dir, file)).toString(),
    });
  }
  return migrations.sort((a, b) => a.version - b.version);
}

/**
 * Validates a PostgreSQL connection string
 * @param connectionString - The connection string to validate
 * @throws {ConfigurationError} If connection string is invalid
 */
function validatePostgresConnectionString(connectionString: string): void {
  if (!connectionString || typeof connectionString !== "string") {
    throw new ConfigurationError("Database connection string is required and must be a string", {
      value: connectionString,
    });
  }

  // Basic PostgreSQL connection string format validation
  // Format: postgres://user:password@host:port/database
  const pgRegex = /^postgres(?:ql)?:\/\/(?:([^:]+)(?::([^@]+))?@)?([^:/]+)(?::(\d+))?\/(.+)$/;

  if (!pgRegex.test(connectionString)) {
    throw new ConfigurationError(
      "Database connection string must be in format: postgres://user:password@host:port/database",
      {
        format: "postgres://user:password@host:port/database",
      },
    );
  }
}

/** Configuration options for the PostgreSQL indexer */
export type PgIndexerConfig = Omit<Types.EclesiaIndexerConfig, "init" | "getNextHeight" | "beginTransaction" | "endTransaction" | "shouldProcessGenesis"> & {
  processGenesis?: boolean                   // Whether to process genesis state
  dbConnectionString: string                 // PostgreSQL connection string
  synchronousCommit?: boolean                // Keep PostgreSQL's synchronous_commit on (default: false, commits are acknowledged before they reach disk)
  exitOnFatal?: boolean                      // Exit the process after a fatal-error (default: true), so an orchestrator can alert or restart
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
  public config: PgIndexerConfig;

  /** Core indexer engine instance */
  public indexer: EclesiaIndexer;

  /** Counter for database client recycling to prevent connection issues */
  private clientReuse: number = 0;

  /** Whether connect() has been called on the current client; a pg Client can only be connected once */
  private clientUsed: boolean = false;

  /** Set while we close a client on purpose (stop, recycling), so its end event is not reported as an unexpected disconnect */
  private closing: boolean = false;

  /** Set once setup() has run the modules' schema setup; modules cannot be added after that */
  private setupDone: boolean = false;

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
    // Validate database connection string
    validatePostgresConnectionString(config.dbConnectionString);

    this.config = config;

    // Initialize PostgreSQL client with connection string
    this.db = this.createClient();

    // Initialize core indexer engine with database callbacks
    this.indexer = new EclesiaIndexer({
      ...config,
      getNextHeight: this.getNextHeight.bind(this),
      beginTransaction: this.beginTransaction.bind(this),
      endTransaction: this.endTransaction.bind(this),
      shouldProcessGenesis: this.shouldProcessGenesis.bind(this),
      onGenesisStart: this.onGenesisStart.bind(this),
      onGenesisComplete: this.onGenesisComplete.bind(this),
    });
    this.indexer.log.info("Indexer instantiated");

    // A fatal-error means the engine has given up (a block failing repeatedly, or maxRetries
    // exceeded). Close everything and exit so the orchestrator can alert or restart.
    this.indexer.on("fatal-error", async (event) => {
      this.indexer.log.error("Fatal: " + event.message + (event.height !== undefined ? " at height " + event.height : ""), {
        error: event.error,
      });
      try {
        await this.stop();
      }
      catch (e) {
        this.indexer.log.error("Error while stopping after a fatal error", {
          error: e,
        });
      }
      if (this.config.exitOnFatal !== false) {
        process.exit(1);
      }
    });

    this.addModules(modules);
  }

  /**
   * Adds indexing modules to the running indexer
   * @param modules - Array of indexing modules to add
   */
  public addModules(modules: Types.IndexingModule[]) {
    if (this.setupDone) {
      throw new ConfigurationError("Modules must be added before setup() runs, or their schema is never set up", {
        modules: modules.map(m => m.name),
      });
    }
    for (let i = 0; i < modules.length; i++) {
      if (this.modules[modules[i].name]) {
        throw new ConfigurationError("Module '" + modules[i].name + "' is already registered", {
          module: modules[i].name,
        });
      }
      this.indexer.log.verbose("Module " + modules[i].name + " initializing");
      modules[i].init(this);
      this.indexer.log.info("Module " + modules[i].name + " initialized");
      this.modules[modules[i].name] = modules[i];
    }
  }

  /**
   * Builds a client with the listeners every client needs. node-postgres never reconnects a
   * Client, so this is the only place one is created; reconnects always go through here.
   */
  private createClient(): Client {
    const client = new Client(this.config.dbConnectionString);
    client.on("end", () => {
      // Ignore the end of a client that has already been replaced or that we are closing ourselves
      if (this.db === client) {
        if (!this.closing) {
          this.indexer.log.warn("Database client disconnected");
        }
        this.instanceConnected = false;
      }
    });
    client.on("error", (err) => {
      this.indexer.log.error("Error in db", {
        error: err,
      });
      this.indexer.prometheus?.recordError("database");
    });
    return client;
  }

  /**
   * Ensures a live connection. The client created in the constructor is used for the first
   * connect; after that (a dropped connection, or a connect that failed) a fresh client is
   * built, because pg refuses to connect the same Client twice.
   */
  private async ensureConnected(): Promise<void> {
    if (this.instanceConnected) {
      return;
    }
    if (this.clientUsed) {
      this.db = this.createClient();
    }
    this.clientUsed = true;
    await this.db.connect();
    this.instanceConnected = true;
    if (!this.config.synchronousCommit) {
      // Set once per connection. The indexer re-processes from the last stored height after a
      // crash, so losing the final few acknowledged commits is recoverable and the throughput
      // gain is large. Opt out with synchronousCommit: true.
      await this.db.query("SET synchronous_commit = OFF");
    }
  }

  /**
   * Applies a module's pending schema migrations, each in its own transaction, recording them
   * in `schema_migrations`. A database created before migrations existed (the module's baseline
   * table is present but nothing is recorded for it) is baselined at the first version without
   * running it again, so existing deployments upgrade in place.
   * @param moduleName - Module the migrations belong to
   * @param migrations - All migrations for the module, in any order
   * @param baselineTable - A table the module's first migration creates, used to detect legacy databases
   * @returns The number of migrations applied
   */
  public async applyMigrations(moduleName: string, migrations: Migration[], baselineTable: string): Promise<number> {
    const sorted = [...migrations].sort((a, b) => a.version - b.version);
    for (let i = 0; i < sorted.length; i++) {
      if (!Number.isInteger(sorted[i].version) || sorted[i].version <= 0 || (i > 0 && sorted[i].version === sorted[i - 1].version)) {
        throw new ConfigurationError("Migration versions for " + moduleName + " must be unique positive integers", {
          versions: sorted.map(m => m.version),
        });
      }
    }
    await this.ensureConnected();
    const db = this.getInstance();

    const applied = new Set<number>();
    await this.beginTransaction();
    try {
      await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (module TEXT NOT NULL, version INTEGER NOT NULL, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (module, version))");
      const rows = await db.query("SELECT version FROM schema_migrations WHERE module=$1", [moduleName]);
      for (const row of rows.rows) {
        applied.add(Number(row.version));
      }
      if (applied.size === 0 && sorted.length > 0) {
        const exists = await db.query("SELECT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = $1)", [baselineTable]);
        if (exists.rows[0].exists) {
          this.indexer.log.info("Schema for " + moduleName + " predates migrations, recording version " + sorted[0].version + " as the baseline");
          await db.query("INSERT INTO schema_migrations(module, version, name) VALUES ($1,$2,$3)", [moduleName, sorted[0].version, sorted[0].name + " (baseline)"]);
          applied.add(sorted[0].version);
        }
      }
      await this.endTransaction(true);
    }
    catch (e) {
      await this.endTransaction(false);
      throw e;
    }

    let count = 0;
    for (const migration of sorted) {
      if (applied.has(migration.version)) {
        continue;
      }
      this.indexer.log.info("Applying migration " + migration.version + " (" + migration.name + ") for " + moduleName);
      await this.beginTransaction();
      try {
        await db.query(migration.sql);
        await db.query("INSERT INTO schema_migrations(module, version, name) VALUES ($1,$2,$3)", [moduleName, migration.version, migration.name]);
        await this.endTransaction(true);
      }
      catch (e) {
        await this.endTransaction(false);
        throw new Error("Migration " + migration.version + " (" + migration.name + ") for " + moduleName + " failed: " + e);
      }
      count++;
    }
    return count;
  }

  /**
   * Stops the engine and closes the database connection
   */
  public async stop(): Promise<void> {
    await this.indexer.stop();
    if (this.instanceConnected) {
      this.closing = true;
      this.instanceConnected = false;
      await this.db.end();
      this.closing = false;
    }
  }

  /**
   * Starts the indexer by connecting to RPC and beginning block processing
   */
  /**
   * Starts indexing and resolves only when the indexer has stopped for good: endHeight reached,
   * stop() called, or a fatal-error. Restarts with backoff keep it running.
   */
  public async run() {
    // start() establishes its own RPC connections (and re-establishes them on recovery)
    await this.indexer.start();
    await this.indexer.whenStopped();
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
    this.setupDone = true;
  }

  /**
   * Determines the next block height to process by querying the database
   * Returns the configured start height if no blocks are found in the database
   * @returns The next block height to process
   */
  public async getNextHeight() {
    try {
      await this.ensureConnected();

      // Query for the highest block height in the database
      const res = await this.db.query("SELECT * FROM blocks ORDER BY height DESC LIMIT 1");
      if (res.rowCount != 0) {
        return Number(res.rows[0].height) + 1;
      }
      else {
        // No blocks found, start from configured height
        return this.config.startHeight ?? DEFAULT_START_HEIGHT;
      }
    }
    catch (e) {
      this.indexer.log.error("Error fetching latest height processed", {
        error: e,
      });
      throw e;
    }
  }

  /**
   * Determines the next block height to process by querying the database
   * Returns the configured start height if no blocks are found in the database
   * @returns The next block height to process
   */
  /** Single-row table recording whether a genesis import started and whether it finished */
  private async ensureGenesisImportTable(): Promise<void> {
    await this.db.query("CREATE TABLE IF NOT EXISTS genesis_import (one_row BOOL PRIMARY KEY DEFAULT TRUE CHECK (one_row), status TEXT NOT NULL, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ)");
  }

  /** Marks the import as in progress before the engine writes anything (autocommitted) */
  private async onGenesisStart(): Promise<void> {
    await this.ensureConnected();
    await this.ensureGenesisImportTable();
    await this.db.query("INSERT INTO genesis_import(status) VALUES ('in_progress') ON CONFLICT (one_row) DO UPDATE SET status = 'in_progress', started_at = now(), completed_at = NULL");
  }

  /** Runs inside the engine's final genesis transaction, so completion commits with the last chunk */
  private async onGenesisComplete(): Promise<void> {
    await this.db.query("UPDATE genesis_import SET status = 'complete', completed_at = now()");
  }

  public async shouldProcessGenesis() {
    if (!this.config.processGenesis) {
      return false;
    }
    try {
      await this.ensureConnected();
      await this.ensureGenesisImportTable();
      const state = await this.db.query("SELECT status FROM genesis_import");
      if (state.rowCount) {
        if (state.rows[0].status === "in_progress") {
          // Chunks of a previous import were committed; importing again on top would double every
          // balance and delegation, so refuse until the database is reset
          throw new ConfigurationError("A previous genesis import did not complete. A partial import cannot be resumed: drop the database (or its public schema) and start again.", {
            startedAt: state.rows[0].started_at,
          });
        }
        return false;
      }

      // Query for the highest block height in the database
      const res = await this.db.query("SELECT * FROM blocks ORDER BY height DESC LIMIT 1");
      if (res.rowCount != 0) {
        return false;
      }
      else {
        if ((this.config.startHeight ?? DEFAULT_START_HEIGHT) === 1) {
          return true;
        }
        else {
          return false;
        }
      }
    }
    catch (e) {
      this.indexer.log.error("Error deciding whether to process genesis", {
        error: e,
      });
      throw e;
    }
  }

  /**
   * Begins a PostgreSQL transaction for atomic block processing
   * Ensures database connection is active before starting transaction
   */
  public async beginTransaction() {
    try {
      await this.ensureConnected();
      await this.db.query("BEGIN");
      this.indexer.log.silly("Transaction started");
    }
    catch (e) {
      this.indexer.log.error("Error beginning transaction", {
        error: e,
      });
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
        // Only increment counter on successful commit
        this.clientReuse++;
      }
      else {
        await this.db.query("ROLLBACK");
        this.indexer.log.silly("Transaction rolled back");
      }
    }
    catch (e) {
      this.indexer.log.error("Error ending transaction", {
        error: e,
      });
      throw e;
    }
    // Database client recycling to prevent long-running connection issues. Done after a
    // successful commit only, and outside the try, so a recycling failure is reported as itself
    // rather than replacing a commit or rollback error.
    if (status && this.clientReuse >= DB_CLIENT_RECYCLE_COUNT) {
      this.indexer.log.info("Recycling database client");
      this.closing = true;
      this.instanceConnected = false;
      await this.db.end();
      this.closing = false;
      this.clientReuse = 0;
      await this.ensureConnected();
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
      // A proxy that times query() and forwards everything else (connect, end, on, escapeIdentifier...)
      // to the real client, so modules see the same object shape at every log level
      const db = this.db;
      const log = this.indexer.log;
      const timedQuery = async (...args: Parameters<Client["query"]>): Promise<ReturnType<Client["query"]>> => {
        const processStart = process.hrtime.bigint();
        const result = await db.query(...args);
        const processEnd = process.hrtime.bigint();
        const duration = Number(processEnd - processStart) / 1e6; // Convert to milliseconds
        log.silly(`Query executed in ${duration.toFixed(3)} ms: ${JSON.stringify(Utils.toPlainObject(args))}`);
        return result;
      };
      return new Proxy(db, {
        get(target, property, receiver) {
          if (property === "query") {
            return timedQuery;
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }
  }
}
