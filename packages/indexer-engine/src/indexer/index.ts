/* eslint-disable @stylistic/no-multi-spaces */
/* eslint-disable max-lines */
import {
  createHash,
} from "node:crypto";
import * as fs from "node:fs";

import {
  BlockResponse, BlockResultsResponse, CometClient, connectComet, Event, StatusResponse, toRfc3339WithNanoseconds,
} from "@cosmjs/tendermint-rpc";
import {
  BlockResultsResponse as BlockResultsResponse38, Event as Event38,
} from "@cosmjs/tendermint-rpc/build/comet38/responses.js";
import {
  MsgExec,
} from "cosmjs-types/cosmos/authz/v1beta1/tx.js";
import {
  QueryValidatorsRequest,
  QueryValidatorsResponse,
} from "cosmjs-types/cosmos/staking/v1beta1/query.js";
import {
  Validator,
} from "cosmjs-types/cosmos/staking/v1beta1/staking.js";
import {
  Tx,
} from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import Fastify, {
  FastifyInstance,
} from "fastify";
import {
  chain,
} from "stream-chain";
import pick from "stream-json/filters/pick.js";
import parser from "stream-json/parser.js";
import streamArray from "stream-json/streamers/stream-array.js";
import streamValues from "stream-json/streamers/stream-values.js";
import batch from "stream-json/utils/batch.js";
import * as winston from "winston";

import {
  CONNECT_TIMEOUT_MS,
  DEFAULT_BATCH_SIZE, DEFAULT_BIND_HOST, DEFAULT_HEALTH_CHECK_PORT, DEFAULT_POLLING_INTERVAL_MS, DEFAULT_PROMETHEUS_PORT, DEFAULT_START_HEIGHT,
  GENESIS_BATCH_SIZE, IDLE_CHECK_INTERVAL_MS, MAX_FAILURES_PER_BLOCK, PAGINATION_LIMITS, PERIODIC_INTERVALS, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS, RPC_TIMEOUT_MS,
} from "../constants.js";
import {
  EclesiaEmitter,
} from "../emitter/index.js";
import {
  ConfigurationError, RPCError,
} from "../errors/index.js";
import {
  IndexerMetrics,
} from "../metrics/index.js";
import {
  CircularBuffer,
} from "../promise-queue/index.js";
import {
  BlockQueue, EclesiaIndexerConfig, EmitFunc, MinimalBlockQueue, WithHeightAndUUID,
} from "../types/index.js";
import {
  decodeAttr, hasBlockEventMode, redactUrl, retryDelay, withTimeout,
} from "../utils/index.js";
import {
  validateFilePath, validatePort, validatePositiveInteger, validateUrl,
} from "../validation/index.js";

/** Default configuration for the Eclesia indexer */
export const defaultIndexerConfig = {
  startHeight: DEFAULT_START_HEIGHT,                  // Start indexing from block 1
  batchSize: DEFAULT_BATCH_SIZE,                      // Process blocks in batches of 500
  modules: [],                                        // No modules enabled by default
  getNextHeight: () => DEFAULT_START_HEIGHT,         // Default height retrieval function
  logLevel: "info" as EclesiaIndexerConfig["logLevel"], // Default log level
  usePolling: false,                                  // Use WebSocket subscription by default
  pollingInterval: DEFAULT_POLLING_INTERVAL_MS,       // Poll every 5 seconds when polling enabled
  shouldProcessGenesis: () => false,                  // Skip genesis processing by default
  minimal: true,                                      // Use minimal indexing by default
  enableHealthcheck: true,                            // Enable health check server by default
  healthCheckPort: DEFAULT_HEALTH_CHECK_PORT,         // Default health check port
  enablePrometheus: false,                            // Disable Prometheus metrics server by default
  prometheusPort: DEFAULT_PROMETHEUS_PORT,           // Default Prometheus metrics server port
  init: () => Promise.resolve(),                      // No-op initialization function
  beginTransaction: () => Promise.resolve(),          // No-op transaction begin function
  endTransaction: (_status: boolean) => Promise.resolve(), // No-op transaction end function
};

/**
 * Core blockchain indexer that connects to Tendermint RPC and processes blocks
 * Extends EclesiaEmitter to provide event-driven architecture for modules
 */
export class EclesiaIndexer extends EclesiaEmitter {
  /** Indexer configuration settings */
  public config: EclesiaIndexerConfig;

  /** Fastify HTTP server for health checks */
  private fastify: FastifyInstance | null = null;

  /** Prometheus HTTP server instance */
  private prometheusServer: FastifyInstance | null = null;

  /** Indicates if the indexer has started */
  private started: boolean = false;

  /** Queue for managing block processing pipeline */
  private blockQueue: BlockQueue;

  /** Latest block height from the chain */
  private latestHeight!: number;

  /** Next block height to process */
  public heightToProcess!: number;

  /** Whether the indexer has been initialized */
  private initialized = false;

  /** Prometheus metrics server instance */
  public prometheus: IndexerMetrics | null = null;

  /** Number of retry attempts for error recovery */
  private retryCount = 0;

  /** CometBFT client for ad-hoc queries */
  public client!: CometClient;

  /** CometBFT client for block and validator queries */
  public blockClient!: CometClient;

  /** Winston logger instance */
  public log: winston.Logger;

  /** Flag indicating if indexer should attempt recovery */
  private tryToRecover: boolean = false;

  /** Health check status for monitoring */
  private healthCheck = {
    status: "CONNECTING",
  };

  /** WebSocket subscription for new block notifications */
  private subscription: ReturnType<CometClient["subscribeNewBlock"]> | null = null;

  /** Timeout handler for block reception */
  private blockTimeout: NodeJS.Timeout | null = null;

  /** Timer for the next poll in polling mode */
  private pollTimer: NodeJS.Timeout | null = null;

  /** Bumped on every (re)start and stop so a polling chain from a previous run exits */
  private pollGeneration = 0;

  /** Bumped on every start() so callbacks left over from a previous run cannot trigger recovery in this one */
  private runGeneration = 0;

  /**
   * Rejecters of waits parked in waitForBlockData(). Each entry is removed as soon as its block
   * arrives, so a healthy run keeps this empty instead of accumulating one entry per block.
   */
  private blockWaiters = new Set<(error: Error) => void>();

  /** Pending restart timer */
  private retryTimer: NodeJS.Timeout | null = null;

  /** Resolves when the indexer has stopped for good: stop() was called, endHeight was reached, or it gave up */
  private stopped: Promise<void> = Promise.resolve();

  private resolveStopped: () => void = () => {};

  /** Next height the fetcher will request; advances as fetches are enqueued */
  private nextFetchHeight = 0;

  /** Whether a fetcher loop is active, and for which run */
  private fetcherRunning = false;

  private fetcherGeneration = 0;

  private fetcherToken = 0;

  /** Height of the block whose processing failed most recently, and how many times in a row */
  private lastFailedHeight: number | undefined;

  private sameHeightFailures = 0;

  /**
   * Creates a new Eclesia indexer instance
   * @param config - Indexer configuration options
   */
  constructor(config: EclesiaIndexerConfig) {
    super();

    // Validate required configuration
    validateUrl(config.rpcUrl, "rpcUrl");
    validatePositiveInteger(config.batchSize, "batchSize");

    // Validate optional genesis path if processing genesis
    if (config.genesisPath) {
      validateFilePath(config.genesisPath, "genesisPath");
    }

    // Validate health check port if provided
    if (config.healthCheckPort !== undefined) {
      validatePort(config.healthCheckPort, "healthCheckPort");
    }

    // Validate prometheus port if provided
    if (config.prometheusPort !== undefined) {
      validatePort(config.prometheusPort, "prometheusPort");
    }

    // Validate start height if provided
    if (config.startHeight !== undefined) {
      validatePositiveInteger(config.startHeight, "startHeight");
    }

    // Validate polling interval if provided
    if (config.pollingInterval !== undefined) {
      validatePositiveInteger(config.pollingInterval, "pollingInterval");
    }

    // Explicit undefined values (typical when config is assembled from env vars) must not
    // override the defaults, so drop them before merging
    const provided = Object.fromEntries(
      Object.entries(config).filter(([, value]) => value !== undefined),
    ) as EclesiaIndexerConfig;
    this.config = {
      ...defaultIndexerConfig,
      ...provided,
    };

    // Structured logging to stdout only: files, rotation and shipping are the deployment's job.
    // Errors are passed as { error } so their stack survives; the text format prints it under
    // the message and the json format emits it as a nested object.
    const errorFormat = winston.format((info) => {
      const error = info.error;
      if (error instanceof Error) {
        info.error = {
          name: error.name,
          message: error.message,
          stack: error.stack,
        };
      }
      else if (error !== undefined && (typeof error !== "object" || error === null)) {
        info.error = {
          message: String(error),
        };
      }
      return info;
    });
    const textFormat = winston.format.printf(({
      level, message, timestamp, error,
    }) => {
      const detail = error as {
        stack?: string
        message?: string
      } | undefined;
      const suffix = detail ? "\n" + (detail.stack ?? detail.message ?? "") : "";
      return `${timestamp} [${level.toUpperCase()}]:\t${message}${suffix}`;
    });
    this.log = winston.createLogger({
      level: this.config.logLevel,
      defaultMeta: {
        service: "Eclesia Indexer",
      },
      transports: [
        new winston.transports.Console({
          format: this.config.logFormat === "json"
            ? winston.format.combine(winston.format.splat(),
              winston.format.timestamp(),
              errorFormat(),
              winston.format.json())
            : winston.format.combine(winston.format.splat(),
              winston.format.timestamp(),
              errorFormat(),
              textFormat,
              winston.format.colorize({
                all: true,
              })),
        }),
      ],
    });

    // cosmjs cannot subscribe to blocks over plain HTTP; that needs a ws:// or wss:// URL.
    // Switch to polling now instead of failing after several restarts.
    const protocol = new URL(this.config.rpcUrl).protocol;
    if (!this.config.usePolling && (protocol === "http:" || protocol === "https:")) {
      this.log.warn("rpcUrl " + redactUrl(this.config.rpcUrl) + " is HTTP, which cannot deliver block subscriptions; polling every " + this.config.pollingInterval + " ms instead (use a ws:// or wss:// URL for WebSocket mode)");
      this.config.usePolling = true;
    }

    // Initialize block queue based on minimal or full indexing mode
    // Pass error handler that uses the logger
    const queueErrorHandler = (e: unknown) => {
      this.prometheus?.recordError("rpc");
      this.log.error("Error enqueueing block data", {
        error: e,
      });
    };

    if (this.config.minimal) {
      // Minimal mode: only store block and block results
      this.blockQueue = new CircularBuffer<[BlockResponse, BlockResultsResponse]>(this.config.batchSize, queueErrorHandler);
    }
    else {
      // Full mode: also store validator information
      this.blockQueue = new CircularBuffer<[BlockResponse, BlockResultsResponse, Uint8Array]>(this.config.batchSize, queueErrorHandler);
    }

    this.on("_unhandled",
      (msg) => {
        // Guarded: this runs once per unhandled message, and winston formats a record before
        // the transport drops it by level
        if (msg.type !== "uuid" && this.log.isVerboseEnabled()) {
          this.log.verbose("Unhandled event: " + msg.type);
        }
      });
    if (this.config.enablePrometheus) {
      this.prometheus = new IndexerMetrics();
      this.prometheusServer = Fastify({
        logger: false,
      });
      this.prometheusServer.get("/metrics",
        async (_req, res) => {
          res.header("Content-Type", this.prometheus!.registry.contentType);
          res.send(await this.prometheus!.getMetrics());
        },
      );

      const prometheusPort = this.config.prometheusPort
        ?? (process.env.PROMETHEUS_PORT ? parseInt(process.env.PROMETHEUS_PORT, 10) : DEFAULT_PROMETHEUS_PORT);
      this.prometheusServer.listen({
        port: prometheusPort,
        host: this.config.prometheusHost ?? DEFAULT_BIND_HOST,
      },
      (err) => {
        if (err) {
          this.log.error("Prometheus server error", {
            error: err,
          });
          this.prometheus?.recordError("metrics_server");
          this.emit("fatal-error", {
            error: err,
            message: "Failed to start metrics server",
          });
        }
      });
    }
    if (this.config.enableHealthcheck) {
      this.fastify = Fastify({
        logger: false,
      });
      this.fastify.get("/health",
        async (_request, reply) => {
          // WAITING means caught up with an idle chain, which is healthy
          const code = this.healthCheck.status == "OK" || this.healthCheck.status == "WAITING"
            ? 200
            : 503;
          reply.code(code).send(this.healthCheck);
        });
      const healthPort = this.config.healthCheckPort
        ?? (process.env.HEALTH_CHECK_PORT ? parseInt(process.env.HEALTH_CHECK_PORT, 10) : DEFAULT_HEALTH_CHECK_PORT);
      this.fastify.listen({
        port: healthPort,
        host: this.config.healthCheckHost ?? DEFAULT_BIND_HOST,
      },
      (err) => {
        if (err) {
          this.log.error("Health check server error", {
            error: err,
          });
          this.prometheus?.recordError("health_check_server");
          this.emit("fatal-error", {
            error: err,
            message: "Failed to start health check server",
          });
        }
      });
    }
  }

  private setStatus(status: string) {
    this.healthCheck.status = status;
    this.prometheus?.setWaiting(status === "WAITING");
  }

  /**
   * Marks the current run for recovery and wakes the main loop if it is parked waiting for a
   * block. Callbacks left over from a previous run pass their generation and are ignored.
   */
  private requestRecovery(reason: string, generation: number = this.runGeneration): void {
    if (generation !== this.runGeneration) {
      this.log.debug("Ignoring recovery request from a previous run: " + reason);
      return;
    }
    if (!this.tryToRecover) {
      this.log.warn("Recovery requested: " + reason);
    }
    this.tryToRecover = true;
    this.wakeBlockWaiters("Recovery requested while waiting for block data");
  }

  /** Rejects every wait parked in waitForBlockData() */
  private wakeBlockWaiters(reason: string): void {
    const waiters = [...this.blockWaiters];
    this.blockWaiters.clear();
    for (const reject of waiters) {
      reject(new RPCError(reason));
    }
  }

  /**
   * Refuses to index a chain other than the configured one. An RPC pool that mixes networks, or
   * a wrong URL, would otherwise write a different chain's blocks into the database.
   */
  private assertChainId(network: string): void {
    if (this.config.chainId !== undefined && network !== this.config.chainId) {
      throw new ConfigurationError("RPC serves chain " + network + " but chainId is configured as " + this.config.chainId, {
        expected: this.config.chainId,
        actual: network,
      });
    }
  }

  /** Counts consecutive processing failures per block height */
  private noteBlockFailure(height: number): void {
    if (height === this.lastFailedHeight) {
      this.sameHeightFailures++;
    }
    else {
      this.lastFailedHeight = height;
      this.sameHeightFailures = 1;
    }
  }

  /** True once one block has failed maxFailuresPerBlock times in a row */
  private isStuck(): boolean {
    return this.lastFailedHeight !== undefined
      && this.sameHeightFailures >= (this.config.maxFailuresPerBlock ?? MAX_FAILURES_PER_BLOCK);
  }

  /**
   * Waits for the next dequeued block but wakes early when recovery or stop is requested, so a
   * loop parked on an empty queue never waits for a block that will not come.
   */
  private waitForBlockData<T>(dequeued: Promise<T>): Promise<T> {
    if (this.tryToRecover || !this.started) {
      return Promise.reject(new RPCError("Recovery requested while waiting for block data"));
    }
    return new Promise<T>((resolve, reject) => {
      this.blockWaiters.add(reject);
      dequeued.then((value) => {
        this.blockWaiters.delete(reject);
        resolve(value);
      },
      (error) => {
        this.blockWaiters.delete(reject);
        reject(error);
      });
    });
  }

  /** (Re)arms the idle check that runs when no block has been announced for a while */
  private armIdleCheck(): void {
    if (this.blockTimeout) {
      clearTimeout(this.blockTimeout);
    }
    this.blockTimeout = setTimeout(() => {
      this.checkLiveness();
    }, IDLE_CHECK_INTERVAL_MS);
  }

  /**
   * Runs when no block has been announced for IDLE_CHECK_INTERVAL_MS. A chain that has stopped
   * producing blocks (halt, upgrade, slow chain) is not an error: the indexer reports WAITING and
   * checks again later. Recovery is requested only when the chain has moved on without us, which
   * means the subscription is dead, or when the RPC cannot be reached at all.
   */
  private async checkLiveness(): Promise<void> {
    if (!this.started) {
      return;
    }
    const generation = this.runGeneration;
    try {
      const status = await withTimeout(this.client.status(), RPC_TIMEOUT_MS, new RPCError("RPC status call timed out"));
      if (!this.started || generation !== this.runGeneration) {
        return;
      }
      const chainHeight = status.syncInfo.latestBlockHeight;
      if (chainHeight > this.latestHeight) {
        this.requestRecovery("chain is at " + chainHeight + " but nothing was announced since " + this.latestHeight, generation);
        return;
      }
      this.log.info("No new block for " + IDLE_CHECK_INTERVAL_MS / 1000 + " s, chain height is still " + chainHeight);
      this.setStatus("WAITING");
      this.armIdleCheck();
    }
    catch (e) {
      this.log.error("Liveness check failed", {
        error: e,
      });
      this.requestRecovery("RPC unreachable during liveness check", generation);
    }
  }

  private blockListener = {
    next: (data: {
      header: {
        height: number
      }
    }) => {
      this.newBlockReceived(data.header.height);
    },
    error: (error: unknown) => {
      this.log.error("Block subscription error", {
        error,
      });
      this.requestRecovery("block subscription errored");
    },
    complete: () => {
      if (this.started) {
        this.requestRecovery("block subscription closed by the node");
      }
    },
  };

  private isMinimal(_blockqueue: BlockQueue): _blockqueue is MinimalBlockQueue {
    if (this.config.minimal) {
      return true;
    }
    else {
      return false;
    }
  }

  public async connect() {
    try {
      if (this.client) {
        this.log.verbose("Recover from error. Attempting to disconnect from RPC");
        try {
          this.client.disconnect();
        }
        catch (_e) { /* empty */ }
        try {
          this.blockClient?.disconnect();
        }
        catch (_e) { /* empty */ }
        this.log.verbose("Disconnected from RPC");
      }
      this.log.info("Attempting to connect to RPC: " + redactUrl(this.config.rpcUrl));
      this.client = await this.connectWithTimeout();
      await withTimeout(this.client.status(), CONNECT_TIMEOUT_MS, new RPCError("RPC status call timed out"));
      this.log.info("Connected to RPC for ad hoc queries");
      this.blockClient = await this.connectWithTimeout();
      await withTimeout(this.blockClient.status(), CONNECT_TIMEOUT_MS, new RPCError("RPC status call timed out"));
      this.log.info("Connected to RPC for block & validator info");

      return true;
    }
    catch (error) {
      this.log.error("RPC connection error", {
        error,
      });
      this.prometheus?.recordError("rpc");
      this.requestRecovery("RPC connection failed");
      return false;
    }
  }

  /**
   * Opens one CometBFT client with its own timeout. If the timeout wins, the client
   * that may still arrive is disconnected so a slow RPC never leaks a socket.
   */
  private async connectWithTimeout(): Promise<CometClient> {
    let timedOut = false;
    const pending = connectComet(this.config.rpcUrl);
    pending.then((client) => {
      if (timedOut) {
        try {
          client.disconnect();
        }
        catch (_e) { /* empty */ }
      }
    }).catch(() => { /* surfaced through the race below */ });
    try {
      return await withTimeout(pending, CONNECT_TIMEOUT_MS, new RPCError("RPC connection timed out"));
    }
    catch (e) {
      timedOut = true;
      throw e;
    }
  }

  private async initialize() {
    if (!this.initialized) {
      try {
        if (this.config.init) {
          await this.config.init();
        }
      }
      catch (e) {
        this.log.error("Failed to initialize indexer", {
          error: e,
        });

        this.prometheus?.recordError("init_error");
        this.setStatus("FAILED");
        throw e;
      }
      if (await this.config.shouldProcessGenesis()) {
        try {
          if (this.config.genesisPath) {
            await this.parseGenesis();
          }
          else {
            this.log.warn("shouldProcessGenesis() returned true but no genesisPath is configured, skipping genesis import");
          }
        }
        catch (e) {
          this.log.error("Failed to parse genesis", {
            error: e,
          });

          this.prometheus?.recordError("genesis_error");
          this.setStatus("FAILED");
          throw e;
        }
      }
      this.initialized = true;
    }
  }

  /**
   * Stops the indexer and releases everything that would keep the process alive:
   * the block subscription, polling and inactivity timers, both RPC clients and the
   * health and metrics servers. Safe to call more than once.
   */
  public async stop(): Promise<void> {
    this.started = false;
    this.resolveStopped();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.wakeBlockWaiters("Indexer stopped while waiting for block data");
    this.stopPolling();
    if (this.blockTimeout) {
      clearTimeout(this.blockTimeout);
      this.blockTimeout = null;
    }
    if (this.subscription) {
      try {
        this.subscription.removeListener(this.blockListener);
      }
      catch (_e) { /* empty */ }
      this.subscription = null;
    }
    for (const client of [this.client, this.blockClient]) {
      try {
        client?.disconnect();
      }
      catch (_e) { /* empty */ }
    }
    const servers = [this.fastify, this.prometheusServer];
    this.fastify = null;
    this.prometheusServer = null;
    await Promise.all(servers.map(server => server?.close().catch((e: unknown) => {
      this.log.warn("Error closing HTTP server", {
        error: e,
      });
    })));
    this.log.info("Indexer stopped");
  }

  private clearBlockQueue() {
    if (this.blockQueue) {
      this.blockQueue.clear();
      this.log.verbose("Starting, clearing block queue");
    }
  }

  private async setupBlockListening() {
    const connected = await this.connect();
    if (!connected) {
      this.setStatus("FAILED");
      throw new RPCError("Failed to connect to RPC");
    }

    try {
      if (!this.config.usePolling && this.subscription) {
        this.subscription.removeListener(this.blockListener);
        this.subscription = null;
        this.log.verbose("Removed existing block listener and subscription");
      }
      if (!this.config.usePolling) {
        this.subscription = this.client.subscribeNewBlock
          ? this.client.subscribeNewBlock()
          : null;
      }
      const status: StatusResponse = await withTimeout(this.client.status(), RPC_TIMEOUT_MS, new RPCError("RPC status call timed out"));
      this.assertChainId(status.nodeInfo.network);
      this.latestHeight = status.syncInfo.latestBlockHeight;
      this.log.info("Connected to " + status.nodeInfo.network + ", current chain height: " + this.latestHeight);

      this.heightToProcess = await this.config.getNextHeight();
      this.nextFetchHeight = this.heightToProcess;
      if (this.config.usePolling) {
        this.startPolling();
      }
      else {
        if (this.subscription) {
          this.subscription.addListener(this.blockListener);
        }
        else {
          this.prometheus?.recordError("rpc");
          throw new Error("Could not subscribe to new blocks");
        }
      }
      // A subscription that never delivers anything must still be noticed
      this.armIdleCheck();
    }
    catch (e) {
      this.log.error("Failed to set up block listening", {
        error: e,
      });
      this.prometheus?.recordError("rpc");
      this.setStatus("FAILED");
      throw e;
    }
  }

  /**
   * Resolves once the indexer has stopped for good: stop() was called, endHeight was reached, or
   * a fatal-error was emitted. Restarts with backoff do not resolve it. Use it to keep a caller
   * waiting for the whole run rather than for the first loop exit.
   */
  public whenStopped(): Promise<void> {
    return this.stopped;
  }

  public async start() {
    if (!this.started) {
      // A fresh run (not a restart after backoff) gets a fresh completion promise
      this.stopped = new Promise<void>((resolve) => {
        this.resolveStopped = resolve;
      });
    }
    this.started = true;
    this.runGeneration++;
    const generation = this.runGeneration;
    this.tryToRecover = false;
    this.blockWaiters.clear();
    this.clearBlockQueue();
    await this.initialize();
    try {
      await this.setupBlockListening();
      this.log.debug("Starting main processing loop");
      this.fetcher().catch((e) => {
        this.setStatus("FAILED");
        this.prometheus?.recordError("rpc");
        this.log.error("Error in fetching service", {
          error: e,
        });
        this.requestRecovery("fetcher failed", generation);
      });
    }
    catch (e) {
      this.requestRecovery("block listening setup failed: " + e, generation);
    }

    let lastProcessed: number | undefined;
    while (this.started && !this.tryToRecover) {
      let txOpen = false;
      let failingHeight: number | undefined;
      try {
        this.prometheus?.updateRetryCount(this.retryCount);
        if (this.blockQueue.synced && this.blockQueue.size() <= 1) {
          // Only the sentinel is queued: we are at the chain tip. Waiting here is normal and can
          // last hours during a halt or an upgrade, so no transaction is held while we wait.
          this.setStatus("WAITING");
        }
        let height: number;
        let timestamp: string;

        // Main block processing (minimal)
        if (this.isMinimal(this.blockQueue)) {
          const toProcess = await this.waitForBlockData(this.blockQueue.dequeue());
          this.log.silly("Retrieved block data");
          if (!toProcess || !toProcess[0] || !toProcess[1]) {
            throw new RPCError("Could not fetch block(minimal)");
          }
          height = toProcess[0].block.header.height;
          failingHeight = height;
          timestamp = toRfc3339WithNanoseconds(toProcess[0].block.header.time);
          // Index block inside a db transaction to ensure data consistency
          await this.config.beginTransaction();
          txOpen = true;
          this.log.silly("Started db tx");
          await this.processBlock(toProcess[0],
            toProcess[1]);
        }
        // Main block processing (full)
        else {
          const toProcess = await this.waitForBlockData(this.blockQueue.dequeue());
          this.log.silly("Retrieved block data");
          if (!toProcess || !toProcess[0] || !toProcess[1] || !toProcess[2]) {
            throw new RPCError("Could not fetch block(full)");
          }

          this.log.silly("Decoded block");
          height = toProcess[0].block.header.height;
          failingHeight = height;
          timestamp = toRfc3339WithNanoseconds(toProcess[0].block.header.time);
          await this.config.beginTransaction();
          txOpen = true;
          this.log.silly("Started db tx");
          await this.processBlock(toProcess[0],
            toProcess[1],
            QueryValidatorsResponse.decode(toProcess[2]).validators);
        }

        // Emit events to trigger periodic operations every 50, 100 and 1000 blocks
        if (height % PERIODIC_INTERVALS.LARGE == 0) {
          await this.asyncEmit("periodic/large",
            {
              value: null,
              height,
              timestamp,
            });
        }
        if (height % PERIODIC_INTERVALS.MEDIUM == 0) {
          await this.asyncEmit("periodic/medium",
            {
              value: null,
              height,
              timestamp,
            });
        }
        if (height % PERIODIC_INTERVALS.SMALL == 0) {
          await this.asyncEmit("periodic/small",
            {
              value: null,
              height,
              timestamp,
            });
        }
        this.log.silly("Handled periodic events");

        await this.config.endTransaction(true);
        txOpen = false;
        lastProcessed = height;
        this.lastFailedHeight = undefined;
        this.sameHeightFailures = 0;

        this.log.silly("Committed db tx");
      }
      catch (e) {
        if (txOpen) {
          try {
            await this.config.endTransaction(false);
          }
          catch (dbe) {
            this.prometheus?.recordError("database");
            this.log.error("Error ending transaction", {
              error: dbe,
            });
          }
        }
        if (!this.started) {
          // stop() woke us up; nothing failed
          break;
        }
        if (failingHeight !== undefined) {
          // The data was there and processing failed: count it against this block
          this.noteBlockFailure(failingHeight);
        }
        // any error here is likely recoverable (e.g. RPC timeout, DB error)
        this.prometheus?.recordError("block");
        this.log.error("Block processing error", {
          error: e,
        });
        this.setStatus("FAILED");
        this.requestRecovery("block processing failed", generation);
        break;
      }
      // Reset retry count and status on successful block processing
      this.retryCount = 0;
      this.setStatus("OK");
      if (this.config.endHeight !== undefined && lastProcessed !== undefined && lastProcessed >= this.config.endHeight) {
        this.log.info("Reached configured end height " + this.config.endHeight + ". Stopping indexer.");
        await this.stop();
        return;
      }
    }

    // Normal exit from processing loop
    if (!this.started) {
      this.log.info("Indexer manually stopped.");
      return;
    }

    // A block that keeps failing after its data was fetched is a bug or bad data, not an outage.
    // Give up loudly instead of retrying it forever.
    if (this.isStuck()) {
      const height = this.lastFailedHeight;
      this.log.error("Block " + height + " failed " + this.sameHeightFailures + " times in a row. This is a deterministic failure in a handler or the data, not an outage. Giving up.");
      this.started = false;
      this.emit("fatal-error", {
        error: new Error("Block " + height + " failed " + this.sameHeightFailures + " times in a row"),
        message: "Block processing is stuck",
        retryCount: this.retryCount,
        height,
      });
      this.resolveStopped();
      return;
    }

    // Abnormal exit: restart with exponential backoff. Retries are unlimited unless maxRetries
    // is configured, because an RPC or database outage of any length must not kill the indexer.
    this.retryCount++;
    if (this.config.maxRetries !== undefined && this.retryCount > this.config.maxRetries) {
      this.log.error("Indexer failed " + this.retryCount + " times in a row, giving up (maxRetries=" + this.config.maxRetries + ")");
      this.started = false;
      this.emit("fatal-error", {
        error: new Error("Max retry attempts exceeded"),
        message: "Indexer failed too many times",
        retryCount: this.retryCount,
      });
      this.resolveStopped();
      return;
    }
    const delay = retryDelay(this.retryCount, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS);
    this.log.warn("Indexer is restarting in " + delay / 1000 + " s (attempt " + this.retryCount + ")");
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.start().catch((e) => {
        this.log.error("Restart failed", {
          error: e,
        });
      });
    }, delay);
  }

  /**
   * Emits an event and waits for its handlers. Handlers run one after another in registration
   * order: they share one database connection and one transaction, so interleaving them at
   * await points would let two handlers read and write the same rows in an unpredictable order,
   * and a failure in one would leave the others mid-flight while the block is rolled back. The
   * first rejection propagates and stops the remaining handlers.
   */
  public asyncEmit: EmitFunc<keyof WithHeightAndUUID<EventMap>> = async (
    type,
    event,
  ) => {
    const handlers = this.handlersFor(type);
    if (handlers.length === 0) {
      // Same routing as emit(): the _unhandled listener logs it at verbose level
      this.emit(type,
        event);
      return;
    }
    for (const handler of handlers) {
      await handler(event);
    }
  };

  private async processBlock(block: BlockResponse, block_results: BlockResultsResponse | BlockResultsResponse38, validators?: Validator[]) {
    const endTimer = this.prometheus?.timeBlockProcessing();
    const height = block.block.header.height;
    this.heightToProcess = height;
    this.log.debug("Processing block: %d",
      height);
    // Initialize height & timestamp to be used for this block-processing run
    const timestamp = toRfc3339WithNanoseconds(block.block.header.time);

    // Use & await asyncEmit to ensure db insertions in order

    /*
     * Emit block information to any interested modules.
     * Primarily the required block module listens to this
     */
    await this.asyncEmit("block",
      {
        value: {
          block,
          block_results,
        },
        height,
        timestamp,
      });
    this.log.silly("Modules handled block event");

    let beginBlockEvents: readonly Event[] | readonly Event38[];
    let endBlockEvents: readonly Event[] | readonly Event38[];
    if ((block_results as BlockResultsResponse38).finalizeBlockEvents) {
      // Cosmos SDK 0.50+ tags each finalize_block event with mode=BeginBlock / mode=EndBlock (baseapp.go)
      beginBlockEvents = (block_results as BlockResultsResponse38).finalizeBlockEvents.filter(x => hasBlockEventMode(x, "BeginBlock")) as readonly Event38[];
      endBlockEvents = (block_results as BlockResultsResponse38).finalizeBlockEvents.filter(x => hasBlockEventMode(x, "EndBlock")) as readonly Event38[];
    }
    else {
      beginBlockEvents = (block_results as BlockResultsResponse).beginBlockEvents;
      endBlockEvents = (block_results as BlockResultsResponse).endBlockEvents;
    }
    // Deal with begin_block events first
    await this.asyncEmit("begin_block",
      {
        value: {
          events: beginBlockEvents!,
          validators,
        },
        height,
        timestamp,
      });

    this.log.silly("Modules handled begin_block events");

    // Then individual tx_events
    await this.asyncEmit("tx_events",
      {
        value: block_results.results,
        height,
        timestamp,
      });
    this.log.silly("Modules handled tx events");

    // Emit details and result for each tx msg separately
    for (let t = 0; t < block.block.txs.length; t++) {
      const tx = Tx.decode(block.block.txs[t]);

      const result = block_results.results[t].code;
      const txlog = block_results.results[t].log;

      if (result != 0) {
        //  Tx failed. Ignore
        continue;
      }
      if (tx.body && tx.body.memo != "") {
        const txHash = createHash("sha256").update(block.block.txs[t])
          .digest("hex");
        await this.asyncEmit("tx_memo",
          {
            value: {
              txHash,
              txBody: tx.body,
            },
            height,
            timestamp,
          });
      }
      // parsing log rather than using events directly in order to have msg_index available to filter appropriate events for each msg
      let events: Array<{
        msg_index?: number
        events: (Event | Event38)[]
      }> = [];
      if (txlog) {
        try {
          const parsed = JSON.parse(txlog);
          if (Array.isArray(parsed)) {
            events = parsed;
          }
        }
        catch (_e) {
          // Not every chain writes a JSON log; the msg_index attributes below cover those
          this.log.silly("Tx log is not JSON, using msg_index attributes instead");
        }
      }
      if (events.length == 0) {
        const eventsToAdd: typeof events = [];
        this.log.silly("No events found in tx log. Parsing events for msg_index");
        for (let m = 0; m < block_results.results[t].events.length; m++) {
          if (block_results.results[t].events[m].attributes.find(a => decodeAttr(a.key) == "msg_index")) {
            const mi = decodeAttr(block_results.results[t].events[m].attributes.find(a => decodeAttr(a.key) == "msg_index")?.value ?? "");
            if (mi != "") {
              const miNum = parseInt(mi);
              let ev = eventsToAdd.find(x => x.msg_index == miNum);
              if (!ev) {
                ev = {
                  msg_index: miNum,
                  events: [block_results.results[t].events[m]],
                };
                eventsToAdd.push(ev);
              }
              else {
                ev.events.push(block_results.results[t].events[m] as Event);
              }
            }
          }
        }
        events = events.concat(eventsToAdd);
      }
      const msgs = tx.body?.messages;

      if (msgs) {
        for (let i = 0; i < msgs.length; i++) {
          if (this.log.isSillyEnabled()) {
            this.log.silly("Indexer broadcasting msg for handling: " + msgs[i].typeUrl);
          }
          const msgevents
            = msgs.length > 1
              ? events.find(x => x.msg_index == i)?.events
              : events[0]?.events ?? [];
          await this.asyncEmit(msgs[i].typeUrl as never,
            {
              value: {
                tx: msgs[i].value as never,
                events: msgevents,
              } as never,
              height,
              timestamp,
            });
          if (msgs[i].typeUrl == "/cosmos.authz.v1beta1.MsgExec") {
            const authzMsgs = MsgExec.decode(msgs[i].value).msgs;
            if (authzMsgs) {
              for (let r = 0; r < authzMsgs.length; r++) {
                if (this.log.isSillyEnabled()) {
                  this.log.silly("Indexer broadcasting msg for handling: " + authzMsgs[r].typeUrl);
                }
                const authzMsgEvents = msgevents?.reduce((events, evt) => {
                  if (evt.attributes.filter(x => decodeAttr(x.key) == "authz_msg_index" && decodeAttr(x.value) == "" + r).length > 0) {
                    events.push(evt);
                  }
                  return events;
                },
                [] as (Event | Event38)[]);
                await this.asyncEmit(authzMsgs[r].typeUrl as never,
                  {
                    value: {
                      tx: authzMsgs[r].value as never,
                      events: authzMsgEvents,
                    } as never,
                    height,
                    timestamp,
                  });
              }
            }
          }
        }
      }
    }
    this.log.silly("Modules handled msg events");
    this.prometheus?.recordTransactions(block.block.txs.length);
    // Then deal with end_block events
    await this.asyncEmit("end_block",
      {
        value: endBlockEvents!,
        height,
        timestamp,
      });
    this.log.silly("Modules handled end_block events");

    endTimer?.();
    this.prometheus?.updateBlockMetrics(height, this.latestHeight, this.blockQueue.size());
  }

  /**
   * Fetches every height from nextFetchHeight up to latestHeight, waiting for queue space
   * before each fetch. Serves the initial catch-up and live blocks alike: a new announcement
   * only moves latestHeight and starts this loop if it is not already running, so bursts and
   * skipped announcements are handled by the same code and the queue can never overflow.
   */
  private async fetcher() {
    if (this.fetcherRunning && this.fetcherGeneration === this.runGeneration) {
      return;
    }
    const generation = this.runGeneration;
    const token = ++this.fetcherToken;
    this.fetcherRunning = true;
    this.fetcherGeneration = generation;
    try {
      while (
        this.nextFetchHeight <= this.latestHeight
        && (this.config.endHeight === undefined || this.nextFetchHeight <= this.config.endHeight)
      ) {
        // If some other async process triggers recovery, exit the fetching loop
        if (this.tryToRecover || !this.started || generation !== this.runGeneration) {
          this.log.verbose("Exiting fetcher loop. Attempting to recover indexer");
          break;
        }
        const i = this.nextFetchHeight;
        this.log.debug("Fetching: " + i);
        try {
          // Main fetching logic for minimal indexer
          if (this.isMinimal(this.blockQueue)) {
            // We do not await here so that multiple fetches can be in-flight
            const toIndex = withTimeout(Promise.all([this.blockClient.block(i) as Promise<BlockResponse>, this.blockClient.blockResults(i) as Promise<BlockResultsResponse>]), RPC_TIMEOUT_MS, new RPCError("Timed out fetching block " + i)).catch((e) => {
              this.log.error("Error fetching block " + i, {
                error: e,
              });
              this.prometheus?.recordError("rpc");
              this.requestRecovery("fetch failed for block " + i, generation);
              return Promise.resolve([]);
            }) as Promise<[BlockResponse, BlockResultsResponse]>;
            this.blockQueue.enqueue(toIndex);
          }
          else {
            // Full indexer: block, block results and the complete validator set
            const toIndex = withTimeout(Promise.all([this.blockClient.block(i) as Promise<BlockResponse>, this.blockClient.blockResults(i) as Promise<BlockResultsResponse>, this.fetchValidatorSet(i)]), RPC_TIMEOUT_MS, new RPCError("Timed out fetching block " + i)).catch((e) => {
              this.log.error("Error fetching block " + i, {
                error: e,
              });
              this.prometheus?.recordError("rpc");
              this.requestRecovery("fetch failed for block " + i, generation);
              return Promise.resolve([]);
            }) as Promise<[BlockResponse, BlockResultsResponse, Uint8Array]>;
            this.blockQueue.enqueue(toIndex);
          }
        }
        catch (e) {
          this.log.error("Fetching error", {
            error: e,
          });
          break;
        }
        this.nextFetchHeight = i + 1;
        // Resolves immediately while the queue has room, otherwise when the processor dequeues
        await this.blockQueue.continue();
      }
      // Caught up with everything announced so far
      if (!this.tryToRecover && this.started && generation === this.runGeneration && !this.blockQueue.synced) {
        this.blockQueue.setSynced();
        this.log.info("Synced to latest height");
      }
    }
    finally {
      if (this.fetcherToken === token) {
        this.fetcherRunning = false;
      }
    }
  }

  /**
   * Runs an ABCI query. A transport failure (RPC down, timeout, empty reply) requests a recovery.
   * A reply with a non-zero code is the chain answering "no" (pruned height, unknown path, bad
   * key): it is thrown as an RPCError with the code and log, and no recovery is requested for
   * ad-hoc queries, so modules can catch it. Block-pipeline queries reject into the fetcher,
   * which requests recovery itself.
   */
  public async callABCI(path: string, data: Uint8Array, height?: number, adHoc: boolean = true): Promise<Uint8Array> {
    let abciq;
    const endTimer = this.prometheus?.timeRpcCall(path) ?? void 0;
    try {
      abciq = await
      (adHoc
        ? this.client
        : this.blockClient).abciQuery({
        path,
        data,
        height: height,
      });
    }
    catch (e) {
      this.setStatus("FAILED");
      this.prometheus?.recordError("rpc");
      this.requestRecovery("ABCI query failed for " + path);
      throw new RPCError("RPC not responding. Query at: " + path + " (" + e + ")");
    }
    finally {
      endTimer?.();
    }
    if (!abciq) {
      this.setStatus("FAILED");
      this.prometheus?.recordError("rpc");
      this.requestRecovery("empty ABCI response for " + path);
      throw new RPCError("RPC not responding. Query at: " + path);
    }
    if (abciq.code) {
      // Previously an error reply decoded as an empty result (for example zero validators)
      this.prometheus?.recordError("rpc");
      throw new RPCError("ABCI query " + path + " failed with code " + abciq.code + (abciq.log ? ": " + abciq.log : ""), path, height, {
        abciCode: abciq.code,
        abciLog: abciq.log,
      });
    }
    return abciq.value;
  }

  /**
   * Fetches the complete validator set at a height, following pagination, and returns it
   * re-encoded as a single QueryValidatorsResponse so the block queue payload keeps its shape.
   * Chains with more validators than one page (1000) were silently truncated before.
   */
  private async fetchValidatorSet(height: number): Promise<Uint8Array> {
    const validators: Validator[] = [];
    let key: Uint8Array | undefined;
    do {
      const request = QueryValidatorsRequest.fromPartial({
        pagination: key
          ? {
            limit: PAGINATION_LIMITS.VALIDATORS,
            key,
          }
          : {
            limit: PAGINATION_LIMITS.VALIDATORS,
          },
      });
      const page = QueryValidatorsResponse.decode(
        await this.callABCI("/cosmos.staking.v1beta1.Query/Validators", QueryValidatorsRequest.encode(request).finish(), height, false),
      );
      validators.push(...page.validators);
      key = page.pagination?.nextKey && page.pagination.nextKey.length > 0 ? page.pagination.nextKey : undefined;
    } while (key);
    return QueryValidatorsResponse.encode(QueryValidatorsResponse.fromPartial({
      validators,
    })).finish();
  }

  private newBlockReceived(height: number): void {
    this.armIdleCheck();
    this.log.info("Received new block: %d",
      height);
    if (height <= this.latestHeight) {
      // Re-announced, or from a lagging node behind a load balancer: never move backwards
      return;
    }
    this.latestHeight = height;
    if (this.tryToRecover || !this.started) {
      return;
    }
    // The fetcher requests every height up to latestHeight and waits for queue space as it
    // goes, so a burst of blocks or an announcement that skipped heights is handled exactly
    // like the initial catch-up. Nothing to do if it is already running.
    this.fetcher().catch((e) => {
      this.log.error("Error in fetching service", {
        error: e,
      });
      this.requestRecovery("fetcher failed");
    });
  }

  /** Starts a single polling chain, retiring any chain left over from a previous run */
  private startPolling(): void {
    this.stopPolling();
    const generation = ++this.pollGeneration;
    this.pollForBlock(generation);
  }

  private stopPolling(): void {
    this.pollGeneration++;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollForBlock(generation: number) {
    if (!this.started || generation !== this.pollGeneration) {
      return;
    }
    try {
      const status = await this.client.status();
      // A restart or stop may have happened while waiting on the RPC
      if (!this.started || generation !== this.pollGeneration) {
        return;
      }
      if (status.syncInfo.latestBlockHeight > this.latestHeight) {
        this.newBlockReceived(status.syncInfo.latestBlockHeight);
      }
    }
    catch (e) {
      this.log.error("Error polling for new block", {
        error: e,
      });
      this.prometheus?.recordError("rpc");
      this.requestRecovery("polling failed");
      // Recovery restarts polling from setupBlockListening
      return;
    }
    this.pollTimer = setTimeout(() => {
      this.pollForBlock(generation);
    },
    this.config.pollingInterval);
  }

  private readGenesis(): fs.ReadStream {
    if (this.config.genesisPath) {
      return fs.createReadStream(this.config.genesisPath);
    }
    else {
      throw new Error("Genesis path not set");
    }
  }

  private async setArrayReader(path: string, processor: (chunk: unknown) => Promise<void>): Promise<boolean> {
    const readPromise = new Promise<boolean>((resolve, reject) => {
      try {
        const filters = path.split(".");
        const pickers = filters.map(filter => pick({
          filter,
        }));
        let counter = 0;
        let chunkCounter = 0;

        // Wrapper processor that handles transaction chunking
        const chunkProcessor = async (data: unknown) => {
          chunkCounter++;
          this.log.debug(`Processing genesis chunk ${chunkCounter}`);

          await processor(data);

          // Commit and restart transaction every 5 chunks (5000 entries)
          // This prevents timeout on large genesis files
          if (chunkCounter % 5 === 0) {
            this.log.debug(`Committing transaction after chunk ${chunkCounter}`);
            await this.config.endTransaction(true);
            await this.config.beginTransaction();
          }
          // Pass the chunk on so the "data" listener below can count what was processed
          return data;
        };

        chain([
          this.readGenesis(),
          parser(),
          ...pickers,
          streamArray(),
          batch({
            batchSize: GENESIS_BATCH_SIZE,
          }),
          chunkProcessor,
        ])
          .on("data",
            (data) => {
              if (data && Array.isArray(data)) {
                counter = counter + data.length;
              }
            })
          .on("end",
            () => {
              this.log.info(`Processed ${counter} entries in ${chunkCounter} chunks`);
              resolve(true);
            })
          // stream-chain re-emits parser and processor errors here; without a listener Node
          // raises them as an uncaught exception and parseGenesis never rolls back
          .on("error",
            (e) => {
              this.log.error("Error reading genesis array " + path, {
                error: e,
              });
              reject(e);
            });
      }
      catch (e) {
        this.log.verbose("Error in setArrayReader: " + e);
        reject(e);
      }
    });

    return readPromise;
  }

  private async setValueReader(path: string, processor: (chunk: unknown) => Promise<void>): Promise<boolean> {
    const readPromise = new Promise<boolean>((resolve, reject) => {
      try {
        const filters = path.split(".");
        const pickers = filters.map(filter => pick({
          filter,
        }));

        let counter = 0;
        chain([this.readGenesis(), parser(), ...pickers, streamValues(), processor])
          .on("data",
            (_data) => {
              counter++;
            })
          .on("end",
            () => {
              this.log.info(`Processed ${counter} entries`);
              resolve(true);
            })
          .on("error",
            (e) => {
              this.log.error("Error reading genesis value " + path, {
                error: e,
              });
              reject(e);
            });
      }
      catch (e) {
        this.log.verbose("Error in setValueReader: " + e);
        reject(e);
      }
    });

    return readPromise;
  }

  private async parseGenesis() {
    this.log.info("Parsing genesis");
    // Lets the storage layer mark the import as in progress before anything is written
    await this.config.onGenesisStart?.();
    await this.config.beginTransaction();
    try {
      this.log.info("Starting genesis import");
      this.log.debug("Importing genesis file...");

      for (const [key, _value] of this.handled) {
        if (key.startsWith("genesis/")) {
          const genesisEntry = key.split("/");

          this.log.verbose("Importing " + key + "...");
          if (genesisEntry[1] == "array") {
            await this.setArrayReader(genesisEntry[2],
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              async (data: any) => {
                await this.asyncEmit(key as never,
                  {
                    value: data.map((x: {
                      value: never
                    }) => x.value),
                  } as never);
                return data;
              });
          }
          else {
            await this.setValueReader(genesisEntry[2],
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              async (data: any) => {
                await this.asyncEmit(key as never,
                  {
                    value: data.value,
                  } as never);
                return data;
              });
          }
        }
      }

      this.log.info("Importing gen TXs...");

      await this.setArrayReader("app_state.genutil.gen_txs",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (data: any) => {
          for (let j = 0; j < data.length; j++) {
            const gentx = data[j].value;
            for (let i = 0; i < gentx.body.messages.length; i++) {
              const msg = gentx.body.messages[i];
              await this.asyncEmit(("gentx" + msg["@type"]) as never,
                {
                  value: msg,
                } as never);
            }
          }
          return data;
        });
      // Recorded inside the last transaction, so "complete" commits together with the final chunk
      await this.config.onGenesisComplete?.();
      await this.config.endTransaction(true);

      this.log.info("Finished importing");
    }
    catch (e) {
      try {
        await this.config.endTransaction(false);
      }
      catch (dbe) {
        this.prometheus?.recordError("database");
        this.log.error("Error ending transaction", {
          error: dbe,
        });
      }
      this.log.error("Failed to import genesis");
      throw e;
    }
  }
}

/** @deprecated Misspelling kept for compatibility, use EclesiaIndexer. Removed in 3.0. */
export const EcleciaIndexer = EclesiaIndexer;
/** @deprecated Misspelling kept for compatibility, use EclesiaIndexer. Removed in 3.0. */
export type EcleciaIndexer = EclesiaIndexer;
