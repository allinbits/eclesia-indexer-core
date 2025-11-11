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
import Parser from "stream-json";
import Pick from "stream-json/filters/Pick.js";
import StreamArray from "stream-json/streamers/StreamArray.js";
import StreamValues from "stream-json/streamers/StreamValues.js";
import Batch from "stream-json/utils/Batch.js";
import {
  v4 as uuidv4,
} from "uuid";
import * as winston from "winston";

import {
  CONNECT_TIMEOUT_MS,
  DEFAULT_BATCH_SIZE, DEFAULT_HEALTH_CHECK_PORT, DEFAULT_POLLING_INTERVAL_MS, DEFAULT_PROMETHEUS_PORT, DEFAULT_START_HEIGHT,
  GENESIS_BATCH_SIZE, PAGINATION_LIMITS, PERIODIC_INTERVALS, QUEUE_DEQUEUE_TIMEOUT_MS, RPC_TIMEOUT_MS,
} from "../constants.js";
import {
  EclesiaEmitter,
} from "../emitter/index.js";
import {
  RPCError,
} from "../errors/index.js";
import {
  IndexerMetrics,
} from "../metrics/index.js";
import {
  CircularBuffer,
} from "../promise-queue/index.js";
import {
  BlockQueue, EcleciaIndexerConfig, EmitFunc, MinimalBlockQueue,
  UUIDEvent, WithHeightAndUUID,
} from "../types/index.js";
import {
  decodeAttr,
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
  logLevel: "info" as EcleciaIndexerConfig["logLevel"], // Default log level
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
export class EcleciaIndexer extends EclesiaEmitter {
  /** Indexer configuration settings */
  public config: EcleciaIndexerConfig;

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

  /**
   * Creates a new Eclesia indexer instance
   * @param config - Indexer configuration options
   */
  constructor(config: EcleciaIndexerConfig) {
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

    this.config = {
      ...defaultIndexerConfig,
      ...config,
    };

    // Initialize logger first so it can be used by queue error handler
    const {
      printf,
    } = winston.format;

    const eclesiaFormat = printf(({
      level, message, timestamp,
    }) => {
      return `${timestamp} [${level.toUpperCase()}]:\t${message}`;
    });
    this.log = winston.createLogger({
      level: this.config.logLevel,
      defaultMeta: {
        service: "Eclesia Indexer",
      },
      transports: [
        new winston.transports.File({
          filename: "error.log",
          level: "error",
        }),
        new winston.transports.File({
          filename: "combined.log",
        }),
        new winston.transports.Console({
          format: winston.format.combine(winston.format.splat(),
            winston.format.timestamp(),
            eclesiaFormat,
            winston.format.colorize({
              all: true,
            })),
        }),
      ],
    });

    // Initialize block queue based on minimal or full indexing mode
    // Pass error handler that uses the logger
    const queueErrorHandler = (e: unknown) => {
      this.prometheus?.recordError("rpc");
      this.log.error("Error enqueueing block data: " + e);
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
        if (msg.uuid) {
          this.log.verbose("Unhandled event: " + msg.type);
          this.emit("uuid",
            {
              status: true,
              uuid: msg.uuid,
            });
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
        host: "0.0.0.0",
      },
      (err) => {
        if (err) {
          this.log.error("Prometheus error: " + err);
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
          const code = this.healthCheck.status == "OK"
            ? 200
            : 503;
          reply.code(code).send(this.healthCheck);
        });
      const healthPort = this.config.healthCheckPort
        ?? (process.env.HEALTH_CHECK_PORT ? parseInt(process.env.HEALTH_CHECK_PORT, 10) : DEFAULT_HEALTH_CHECK_PORT);
      this.fastify.listen({
        port: healthPort,
        host: "0.0.0.0",
      },
      (err) => {
        if (err) {
          this.log.error("Health check server error: " + err);
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
  }

  private blockListener = {
    next: (data: {
      header: {
        height: number
      }
    }) => {
      this.newBlockReceived(data.header.height);
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
      if (this.client && this.tryToRecover) {
        this.log.verbose("Recover from error. Attempting to disconnect from RPC");
        this.client.disconnect();
        this.blockClient.disconnect();
        this.log.verbose("Disconnected from RPC");
      }
      const connectTimeoutPromise = new Promise<ReturnType<typeof connectComet>>((resolve, reject) => {
        setTimeout(reject, CONNECT_TIMEOUT_MS, []);
      });
      this.client = await Promise.race([connectComet(this.config.rpcUrl), connectTimeoutPromise]);
      this.log.info("Connected to RPC for ad hoc queries");
      this.blockClient = await Promise.race([connectComet(this.config.rpcUrl), connectTimeoutPromise]);
      this.log.info("Connected to RPC for block & validator info");

      return true;
    }
    catch (error) {
      this.log.error("RPC connection error: " + error);
      this.prometheus?.recordError("rpc");
      this.tryToRecover = true;
      return false;
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
        this.log.error("Failed to initialize indexer: " + e);

        this.prometheus?.recordError("init_error");
        this.setStatus("FAILED");
        throw e;
      }
      if (await this.config.shouldProcessGenesis()) {
        try {
          if (this.config.genesisPath) {
            await this.parseGenesis();
          }
        }
        catch (e) {
          this.log.error("Failed to parse genesis: " + e);

          this.prometheus?.recordError("genesis_error");
          this.setStatus("FAILED");
          throw e;
        }
      }
      this.initialized = true;
    }
  }

  public stop() {
    this.started = false;
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
      const statusPromise: Promise<StatusResponse> = new Promise((resolve, reject) => {
        setTimeout(reject,
          RPC_TIMEOUT_MS,
          false);
      });
      const status = await Promise.race([this.client.status(), statusPromise]);
      this.latestHeight = status.syncInfo.latestBlockHeight;
      this.log.info("Current chain height: " + this.latestHeight);

      this.heightToProcess = await this.config.getNextHeight();
      if (this.config.usePolling) {
        this.pollForBlock();
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
    }
    catch (e) {
      this.log.error("Failed to set up block listening: " + e);
      this.prometheus?.recordError("rpc");
      this.setStatus("FAILED");
      throw e;
    }
  }

  public async start() {
    this.started = true;
    this.clearBlockQueue();
    await this.initialize();
    try {
      await this.setupBlockListening();
      this.log.debug("Starting main processing loop");
      this.tryToRecover = false;
      this.fetcher().catch((e) => {
        this.setStatus("FAILED");
        this.prometheus?.recordError("rpc");
        throw new Error("Error in fetching service: " + e);
      });
    }
    catch (_e) {
      // Continue and attempt to recover
    }

    while (
      this.started // break out when stopped
      && !this.tryToRecover // break out for recoverable errors
      && (this.config.endHeight === undefined || this.heightToProcess <= this.config.endHeight) // break out if end height configured and reached
      && this.blockQueue.size() > 0  // break out if no blocks to process
    ) {
      // await the dequeued promise is essentially awaiting fetched data for that block
      try {
        this.prometheus?.updateRetryCount(this.retryCount);
        // Index block inside a db transaction to ensure data consistency
        await this.config.beginTransaction();
        this.log.silly("Started db tx");
        let height, timestamp;

        // Main block processing (minimal)
        if (this.isMinimal(this.blockQueue)) {
          const timeoutPromise: ReturnType<typeof this.blockQueue.dequeue> = new Promise((resolve, reject) => {
            setTimeout(reject, QUEUE_DEQUEUE_TIMEOUT_MS, []);
          });
          const toProcess = await Promise.race([this.blockQueue.dequeue(), timeoutPromise]);
          this.log.silly("Retrieved block data");
          if (!toProcess || !toProcess[0] || !toProcess[1]) {
            throw new RPCError("Could not fetch block(minimal)");
          }
          height = toProcess[0].block.header.height;
          timestamp = toRfc3339WithNanoseconds(toProcess[0].block.header.time);
          await this.processBlock(toProcess[0],
            toProcess[1]);
        }
        // Main block processing (full)
        else {
          const timeoutPromise: ReturnType<typeof this.blockQueue.dequeue> = new Promise((resolve, reject) => {
            setTimeout(reject, QUEUE_DEQUEUE_TIMEOUT_MS, []);
          });
          const toProcess = await Promise.race([this.blockQueue.dequeue(), timeoutPromise]);
          this.log.silly("Retrieved block data");
          if (!toProcess || !toProcess[0] || !toProcess[1] || !toProcess[2]) {
            throw new RPCError("Could not fetch block(full)");
          }

          this.log.silly("Decoded block");
          height = toProcess[0].block.header.height;
          timestamp = toRfc3339WithNanoseconds(toProcess[0].block.header.time);
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

        this.log.silly("Committed db tx");
      }
      catch (e) {
        // any error here is likely recoverable (e.g. RPC timeout, DB error)
        this.prometheus?.recordError("block");
        this.log.error("Block processing error: " + e);
        this.setStatus("FAILED");
        try {
          await this.config.endTransaction(false);
        }
        catch (dbe) {
          this.prometheus?.recordError("database");
          this.log.error("Error ending transaction. Must be a DB error: " + dbe);
        }
        this.tryToRecover = true;
        this.retryCount++;
        // Exit processing loop to attempt recovery
        break;
      }
      // Reset retry count and status on successful block processing
      this.retryCount = 0;
      this.setStatus("OK");
    }

    // Normal exit from processing loop
    if (!this.started) {
      this.log.info("Indexer manually stopped.");
      return;
    }
    if (this.config.endHeight !== undefined && this.heightToProcess >= this.config.endHeight!) {
      this.log.info("Reached configured end height. Stopping indexer.");
      this.stop();
      return;
    }

    // Abnormal exit
    if (this.retryCount < 3) {
      this.log.debug("Indexer retryCount: " + this.retryCount);
      this.retryCount++;
      this.log.info("Indexer is restarting");
      // Attempt recovery after brief delay
      setTimeout(() => this.start(),
        this.retryCount * 5000);
    }
    else {
      this.log.info("Indexer failed too many times. Exiting.");
      this.emit("fatal-error", {
        error: new Error("Max retry attempts exceeded"),
        message: "Indexer failed too many times",
        retryCount: this.retryCount,
      });
    }
  }

  public asyncEmit: EmitFunc<keyof WithHeightAndUUID<EventMap>> = async (
    type,
    event,
  ) => {
    event.uuid = uuidv4();

    /*
     * More than 1 listener can be registered for an event type
     * Fortunately these are all set up during module init() so we have a consistent count
     * so we can count responses to resolve when complete
     * values are irrelevant as promise resolution is only used for flow control
     */
    let listenerCount = this.handled.get(type);
    if (!listenerCount) {
      // Setting listenerCount to 1 (the unhandled listener)
      listenerCount = 1;
    }
    let listenersResponded = 0;
    const prom = new Promise<void>((resolve, reject) => {
      const returnFunc = (ev: UUIDEvent) => {
        if (ev.uuid == event.uuid) {
          if (ev.status) {
            listenersResponded++;
            if (listenersResponded == listenerCount) {
              // All listeners have done their thing so we can remove listener, resolve and continue execution
              this.off("uuid",
                returnFunc);
              resolve();
            }
          }
          else {
            // At least 1 listener is reporting an error. Reject and handle exception at the original asyncEmit location
            reject(ev.error);
          }
        }
      };
      this.on("uuid",
        returnFunc);
    });
    this.emit(type,
      event);

    return prom;
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
      beginBlockEvents = (block_results as BlockResultsResponse38).finalizeBlockEvents.filter(x => x.attributes.find(a => decodeAttr(a.key) == "mode" && decodeAttr(a.value) == "begin_block")) as readonly Event38[];
      endBlockEvents = (block_results as BlockResultsResponse38).finalizeBlockEvents.filter(x => x.attributes.find(a => decodeAttr(a.key) == "mode" && decodeAttr(a.value) == "end_block")) as readonly Event38[];
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
      }> = txlog
        ? JSON.parse(txlog)
        : [];
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
          this.log.silly("Indexer broadcasting msg for handling: " + msgs[i].typeUrl);
          const msgevents
            = msgs.length > 1
              ? events.find(x => x.msg_index == i)?.events
              : events[0].events;
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
                this.log.silly("Indexer broadcasting msg for handling: " + authzMsgs[r].typeUrl);
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

  private async fetcher() {
    for (let i = this.heightToProcess; i <= this.latestHeight; i++) {
      // If some other async process triggers recovery, exit the fetching loop
      if (this.tryToRecover) {
        this.log.verbose("Exiting fetcher loop. Attempting to recover indexer");
        break;
      }
      this.log.debug("Fetching: " + i);
      try {
        // Main fetching logic for minimal indexer
        if (this.isMinimal(this.blockQueue)) {
          const timeoutPromise: Promise<[BlockResponse, BlockResultsResponse]> = new Promise((resolve, reject) => {
            setTimeout(reject,
              RPC_TIMEOUT_MS,
              false);
          });
          // We do not await here so that multiple fetches can be in-flight
          const toIndex = Promise.race([Promise.all([this.blockClient.block(i) as Promise<BlockResponse>, this.blockClient.blockResults(i) as Promise<BlockResultsResponse>]), timeoutPromise]).catch((e) => {
            this.log.error("Error fetching block: " + i + " : " + e);
            this.prometheus?.recordError("rpc");
            this.tryToRecover = true;
            return Promise.resolve([]);
          }) as Promise<[BlockResponse, BlockResultsResponse]>;
          this.blockQueue.enqueue(toIndex);
        }
        else {
          // Main fetching logic for minimal indexer
          const timeoutPromise: Promise<[BlockResponse, BlockResultsResponse, Uint8Array]> = new Promise((resolve, reject) => {
            setTimeout(reject,
              RPC_TIMEOUT_MS,
              false);
          });
          const q = QueryValidatorsRequest.fromPartial({
            pagination: {
              limit: PAGINATION_LIMITS.VALIDATORS,
            },
          });
          const vals = QueryValidatorsRequest.encode(q).finish();
          // We do not await here so that multiple fetches can be in-flight
          const toIndex = Promise.race([
            Promise.all([
              this.blockClient.block(i) as Promise<BlockResponse>,
              this.blockClient.blockResults(i) as Promise<BlockResultsResponse>,
              this.callABCI("/cosmos.staking.v1beta1.Query/Validators",
                vals,
                i,
                false),
            ]),
            timeoutPromise,
          ]).catch((e) => {
            this.log.error("Error fetching block: " + i + " : " + e);
            this.tryToRecover = true;
            return Promise.resolve([]);
          }) as Promise<[BlockResponse, BlockResultsResponse, Uint8Array]>;
          this.blockQueue.enqueue(toIndex);
        }
      }
      catch (e) {
        this.log.error("Fetching error: " + e);
        break;
      }
      await this.blockQueue.continue();
      if (this.tryToRecover) {
        this.log.verbose("Exiting fetcher loop. Attempting to recover indexer");
        break;
      }
    }
    // If we exit the fetching loop without errors, we are synced
    if (!this.tryToRecover) {
      this.blockQueue.setSynced();
      this.log.info("Synced to latest height");
    }
  }

  public async callABCI(path: string, data: Uint8Array, height?: number, adHoc: boolean = true): Promise<Uint8Array> {
    try {
      const endTimer = this.prometheus?.timeRpcCall(path) ?? void 0;
      const abciq = await
      (adHoc
        ? this.client
        : this.blockClient).abciQuery({
        path,
        data,
        height: height,
      });
      endTimer?.();
      if (abciq) {
        return abciq.value;
      }
      else {
        this.tryToRecover = true;
        this.setStatus("FAILED");
        this.prometheus?.recordError("rpc");
        throw new Error("RPC not responding. Query at: " + path);
      }
    }
    catch (_e) {
      this.tryToRecover = true;
      this.setStatus("FAILED");
      this.retryCount++;
      throw new Error("RPC not responding. Query at: " + path);
    }
  }

  private newBlockReceived(height: number): void {
    if (this.blockTimeout) {
      clearTimeout(this.blockTimeout);
    }
    this.blockTimeout = setTimeout(() => {
      this.tryToRecover = true;
    }, 30000);
    this.log.info("Received new block: %d",
      height);
    if (height == this.latestHeight) {
      return;
    }
    // If we are synced, add to end of queue
    if (this.blockQueue.synced && !this.tryToRecover) {
      this.latestHeight = height;
      if (this.blockQueue.size() + 1 == this.config.batchSize) {
        this.prometheus?.recordError("block");
        this.log.error("Block queue is full. Cannot add new block");
        this.tryToRecover = true;
        this.retryCount++;
        return;
      }
      try {
        if (this.isMinimal(this.blockQueue)) {
          this.blockQueue.enqueue(Promise.all([this.client.block(height) as Promise<BlockResponse>, this.client.blockResults(height) as Promise<BlockResultsResponse>]).catch((e) => {
            this.log.error("Error fetching block: " + height + " : " + e);

            return Promise.resolve([]);
          }) as Promise<[BlockResponse, BlockResultsResponse]>);
        }
        else {
          const q = QueryValidatorsRequest.fromPartial({
            pagination: {
              limit: 1000n,
            },
          });
          const vals = QueryValidatorsRequest.encode(q).finish();
          this.blockQueue.enqueue(Promise.all([
            this.client.block(height) as Promise<BlockResponse>,
            this.client.blockResults(height) as Promise<BlockResultsResponse>,
            this.callABCI("/cosmos.staking.v1beta1.Query/Validators",
              vals,
              height,
              false),
          ]).catch((e) => {
            this.log.error("Error fetching block: " + height + " : " + e);
            return Promise.resolve([]);
          }) as Promise<[BlockResponse, BlockResultsResponse, Uint8Array]>);
        }
      }
      catch (e) {
        this.log.error("New Block Received error: " + e);
      }
    }
    else {
      this.latestHeight = height;
    }
  }

  private async pollForBlock() {
    try {
      const status = await this.client.status();
      if (status.syncInfo.latestBlockHeight > this.latestHeight) {
        while (this.latestHeight < status.syncInfo.latestBlockHeight) {
          this.newBlockReceived(this.latestHeight + 1);
        }
      }
      setTimeout(() => {
        this.pollForBlock();
      },
      this.config.pollingInterval);
    }
    catch (e) {
      this.log.error("Error polling for new block: " + e);
      this.tryToRecover = true;
      this.retryCount++;
    }
  }

  private readGenesis(): Parser.Parser {
    if (this.config.genesisPath) {
      return fs.createReadStream(this.config.genesisPath).pipe(Parser.parser());
    }
    else {
      throw new Error("Genesis path not set");
    }
  }

  private async setArrayReader(path: string, processor: (chunk: unknown) => Promise<void>): Promise<boolean> {
    const readPromise = new Promise<boolean>((resolve, reject) => {
      try {
        const filters = path.split(".");
        const pickers = filters.map(filter => Pick.pick({
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
        };

        chain([
          this.readGenesis(),
          ...pickers,
          StreamArray.streamArray(),
          Batch.batch({
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
            });
      }
      catch (_e) {
        this.log.verbose("Error in setArrayReader: " + _e);
        reject();
      }
    });

    return readPromise;
  }

  private async setValueReader(path: string, processor: (chunk: unknown) => Promise<void>): Promise<boolean> {
    const readPromise = new Promise<boolean>((resolve, reject) => {
      try {
        const filters = path.split(".");
        const pickers = filters.map(filter => Pick.pick({
          filter,
        }));

        let counter = 0;
        chain([this.readGenesis(), ...pickers, StreamValues.streamValues(), processor])
          .on("data",
            (_data) => {
              counter++;
            })
          .on("end",
            () => {
              this.log.info(`Processed ${counter} entries`);
              resolve(true);
            });
      }
      catch (_e) {
        reject();
      }
    });

    return readPromise;
  }

  private async parseGenesis() {
    this.log.info("Parsing genesis");
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
      await this.config.endTransaction(true);

      this.log.info("Finished importing");
    }
    catch (e) {
      try {
        await this.config.endTransaction(false);
      }
      catch (dbe) {
        this.prometheus?.recordError("database");
        this.log.error("Error ending transaction. Must be a DB error: " + dbe);
      }
      this.log.error("Failed to import genesis");
      throw e;
    }
  }
}
