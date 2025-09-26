/* eslint-disable @stylistic/no-multi-spaces */
/* eslint-disable max-lines */
import {
  createHash,
} from "node:crypto";
import * as fs from "node:fs";

import {
  BlockResponse, BlockResultsResponse, CometClient, connectComet, Event, toRfc3339WithNanoseconds,
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
  EclesiaEmitter,
} from "../emitter/index.js";
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

/** Default configuration for the Eclesia indexer */
export const defaultIndexerConfig = {
  startHeight: 1,                                     // Start indexing from block 1
  batchSize: 500,                                     // Process blocks in batches of 500
  modules: [],                                        // No modules enabled by default
  getNextHeight: () => 1,                            // Default height retrieval function
  logLevel: "info" as EcleciaIndexerConfig["logLevel"], // Default log level
  usePolling: false,                                  // Use WebSocket subscription by default
  pollingInterval: 5000,                              // Poll every 5 seconds when polling enabled
  shouldProcessGenesis: () => false,                  // Skip genesis processing by default
  minimal: true,                                      // Use minimal indexing by default
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
  private config: EcleciaIndexerConfig;

  /** Fastify HTTP server for health checks */
  private fastify: FastifyInstance;

  /** Queue for managing block processing pipeline */
  private blockQueue: BlockQueue;

  /** Latest block height from the chain */
  private latestHeight!: number;

  /** Next block height to process */
  private heightToProcess!: number;

  /** Whether the indexer has been initialized */
  private initialized = false;

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

  /**
   * Creates a new Eclesia indexer instance
   * @param config - Indexer configuration options
   */
  constructor(config: EcleciaIndexerConfig) {
    super();
    this.config = {
      ...defaultIndexerConfig,
      ...config,
    };

    // Initialize block queue based on minimal or full indexing mode
    if (this.config.minimal) {
      // Minimal mode: only store block and block results
      this.blockQueue = new CircularBuffer<[BlockResponse, BlockResultsResponse]>(this.config.batchSize);
    }
    else {
      // Full mode: also store validator information
      this.blockQueue = new CircularBuffer<[BlockResponse, BlockResultsResponse, Uint8Array]>(this.config.batchSize);
    }
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
    this.fastify = Fastify({
      logger: false,
    });
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
    this.fastify.get("/health",
      async (_request, reply) => {
        const code = this.healthCheck.status == "OK"
          ? 200
          : 503;
        reply.code(code).send(this.healthCheck);
      });
    this.fastify.listen({
      port: 80,
      host: "0.0.0.0",
    },
    (err) => {
      if (err) {
        this.log.error(err);
        process.exit(1);
      }
    });
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
      this.client = await connectComet(this.config.rpcUrl);
      this.log.info("Connected to RPC for ad hoc queries");

      this.blockClient = await connectComet(this.config.rpcUrl);
      this.log.info("Connected to RPC for block & validator info");

      return true;
    }
    catch (error) {
      this.log.error(error);
      this.tryToRecover = true;
      return false;
    }
  }

  public async start() {
    if (this.blockQueue) {
      this.blockQueue.clear();
      this.log.verbose("Starting, clearing block queue");
    }
    if (!this.initialized) {
      try {
        if (this.config.init) {
          await this.config.init();
        }
      }
      catch (e) {
        this.log.error("Failed to initialize indexer: " + e);
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
          this.setStatus("FAILED");
          throw e;
        }
      }
      this.initialized = true;
    }
    try {
      await this.connect();
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
      const status = await this.client.status();
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
          throw new Error("Could not subscribe to new blocks");
        }
      }
    }
    catch (e) {
      this.log.error("Failed to set up block listening: " + e);
      this.setStatus("FAILED");
      throw e;
    }

    this.tryToRecover = false;
    this.fetcher().catch((e) => {
      this.setStatus("FAILED");
      throw new Error("Error in fetching service: " + e);
    });

    const hrTime = process.hrtime();
    let ms = hrTime[0] * 1000000 + hrTime[1] / 1000;
    while (this.blockQueue.size() > 0 && !this.tryToRecover) {
      // await the dequeued promise is essentially awaiting fetched data for that block
      try {
        if (this.tryToRecover) {
          throw new Error("Exiting processing loop. Attempting to recover indexer");
        }
        // Index block inside a db transaction to ensure data consistency
        await this.config.beginTransaction();
        this.log.silly("Started db tx");
        let height, timestamp;
        if (this.isMinimal(this.blockQueue)) {
          const toProcess = await this.blockQueue.dequeue();
          this.log.silly("Retrieved block data");
          if (!toProcess || !toProcess[0] || !toProcess[1]) {
            throw new Error("Could not fetch block");
          }
          height = toProcess[0].block.header.height;
          timestamp = toRfc3339WithNanoseconds(toProcess[0].block.header.time);
          await this.processBlock(toProcess[0],
            toProcess[1]);
        }
        else {
          const toProcess = await this.blockQueue.dequeue();
          this.log.silly("Retrieved block data");
          if (!toProcess || !toProcess[0] || !toProcess[1] || !toProcess[2]) {
            throw new Error("Could not fetch block");
          }

          this.log.silly("Decoded block");
          height = toProcess[0].block.header.height;
          timestamp = toRfc3339WithNanoseconds(toProcess[0].block.header.time);
          await this.processBlock(toProcess[0],
            toProcess[1],
            QueryValidatorsResponse.decode(toProcess[2]).validators);
        }
        // Emit events to trigger periodic operations every 50, 100 and 1000 blocks
        if (height % 1000 == 0) {
          const hrTime = process.hrtime();
          const newms = hrTime[0] * 1000000 + hrTime[1] / 1000;
          const duration = newms - ms;
          ms = newms;
          const rate = 1000000000 / duration;
          this.log.info("Processing:" + rate.toFixed(2) + "blocks/sec");
          await this.asyncEmit("periodic/1000",
            {
              value: null,
              height,
              timestamp,
            });
        }
        if (height % 100 == 0) {
          await this.asyncEmit("periodic/100",
            {
              value: null,
              height,
              timestamp,
            });
        }
        if (height % 50 == 0) {
          await this.asyncEmit("periodic/50",
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
        this.log.error("" + e);
        this.setStatus("FAILED");
        try {
          await this.config.endTransaction(false);
        }
        catch (dbe) {
          this.log.error("Error ending transaction. Must be a DB error: " + dbe);
        }
        this.tryToRecover = true;
        this.retryCount++;
        break;
      }
      this.retryCount = 0;
      this.setStatus("OK");
    }
    if (this.retryCount < 3) {
      this.log.debug("Indexer retryCount: " + this.retryCount);
      this.log.info("Indexer is restarting");
      setTimeout(() => this.start(),
        this.retryCount * 5000);
    }
    else {
      this.log.info("Indexer failed too many times. Exiting.");
      process.exit(1);
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
    let processStart: [number, number] = [0, 0];
    if (this.config.logLevel == "silly") {
      processStart = process.hrtime();
    }
    const height = block.block.header.height;
    this.log.debug("Processing block: %d",
      height);
    this.log.silly("Started db tx");

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
      const events: Array<{
        msg_index?: number
        events: Event[]
      }> = txlog
        ? JSON.parse(txlog)
        : [];
      if (events.length == 0) {
        events.concat(block_results.results[t].events.;
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
                [] as Event[]);
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

    // Then deal with end_block events
    await this.asyncEmit("end_block",
      {
        value: endBlockEvents!,
        height,
        timestamp,
      });
    this.log.silly("Modules handled end_block events");
    if (this.config.logLevel == "silly") {
      const processEnd = process.hrtime(processStart);
      const processTime = processEnd[0] * 1000 + processEnd[1] / 1000000;
      this.log.silly("Processed block %d in %d ms",
        height,
        processTime.toFixed(2));
    }
  }

  private async fetcher() {
    for (let i = this.heightToProcess; i <= this.latestHeight; i++) {
      this.log.debug("Fetching: " + i);
      if (this.tryToRecover) {
        this.log.verbose("Exiting fetcher loop. Attempting to recover indexer");
        break;
      }
      try {
        if (this.isMinimal(this.blockQueue)) {
          const timeoutPromise: Promise<[BlockResponse, BlockResultsResponse]> = new Promise((resolve, reject) => {
            setTimeout(reject,
              20000,
              false);
          });
          const toIndex = Promise.race([Promise.all([this.blockClient.block(i) as Promise<BlockResponse>, this.blockClient.blockResults(i) as Promise<BlockResultsResponse>]), timeoutPromise]).catch((e) => {
            this.log.error("Error fetching block: " + i + " : " + e);
            this.tryToRecover = true;
            return Promise.resolve([]);
          }) as Promise<[BlockResponse, BlockResultsResponse]>;
          this.blockQueue.enqueue(toIndex);
        }
        else {
          const timeoutPromise: Promise<[BlockResponse, BlockResultsResponse, Uint8Array]> = new Promise((resolve, reject) => {
            setTimeout(reject,
              20000,
              false);
          });
          const q = QueryValidatorsRequest.fromPartial({
            pagination: {
              limit: 1000n,
            },
          });
          const vals = QueryValidatorsRequest.encode(q).finish();
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
        await this.blockQueue.continue();
        if (this.tryToRecover) {
          this.retryCount++;
          throw new Error("RPC not responding");
        }
      }
      catch (e) {
        this.log.error(e);
        break;
      }
    }
    if (!this.tryToRecover) {
      this.blockQueue.setSynced();
      this.log.info("Synced to latest height");
    }
  }

  public async callABCI(path: string, data: Uint8Array, height?: number, adHoc: boolean = true): Promise<Uint8Array> {
    try {
      const abciq = await
      (adHoc
        ? this.client
        : this.blockClient).abciQuery({
        path,
        data,
        height: height,
      });
      if (abciq) {
        return abciq.value;
      }
      else {
        this.tryToRecover = true;
        this.setStatus("FAILED");
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
    this.log.info("Received new block: %d",
      height);
    if (height == this.latestHeight) {
      return;
    }
    // If we are synced, add to end of queue
    if (this.blockQueue.synced && !this.tryToRecover) {
      this.latestHeight = height;
      if (this.blockQueue.size() + 1 == this.config.batchSize) {
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
        this.log.error("" + e);
      }
    }
    else {
      this.latestHeight = height;
    }
  }

  private async pollForBlock() {
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
        chain([
          this.readGenesis(),
          ...pickers,
          StreamArray.streamArray(),
          Batch.batch({
            batchSize: 1000,
          }),
          processor,
        ])
          .on("data",
            (data) => {
              if (data && Array.isArray(data)) {
                counter = counter + data.length;
              }
            })
          .on("end",
            () => {
              this.log.info(`Processed ${counter} entries`);
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
        this.log.error("Error ending transaction. Must be a DB error: " + dbe);
      }
      this.log.error("Failed to import genesis");
      throw e;
    }
  }
}
