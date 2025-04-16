import { createHash } from "node:crypto";
import fs from "node:fs";

import { BlockResponse, BlockResultsResponse, CometClient, toRfc3339WithNanoseconds } from "@cosmjs/tendermint-rpc";
import { connectComet } from "@cosmjs/tendermint-rpc";
import { Event } from "@cosmjs/tendermint-rpc";
import { MsgExec } from "cosmjs-types/cosmos/authz/v1beta1/tx";
import {
  QueryValidatorsRequest,
  QueryValidatorsResponse
} from "cosmjs-types/cosmos/staking/v1beta1/query";
import { Validator } from "cosmjs-types/cosmos/staking/v1beta1/staking";
import { Tx } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import Fastify, { FastifyInstance } from "fastify";
import { chain } from "stream-chain";
import { Parser, parser } from "stream-json";
import { pick } from "stream-json/filters/Pick";
import { streamArray } from "stream-json/streamers/StreamArray";
import { streamValues } from "stream-json/streamers/StreamValues";
import { v4 as uuidv4 } from "uuid";
import winston from "winston";

import { EclesiaEmitter } from "../emitter";
import { PromiseQueue } from "../promise-queue";
import { BlockQueue, EcleciaIndexerConfig, EmitFunc, MinimalBlockQueue, WithHeightAndUUID } from "../types";
import { UUIDEvent } from "../types";
import { decodeAttr } from "../utils";

export const defaultIndexerConfig = {
  startHeight: 1,
  batchSize: 500,
  modules: [],
  getNextHeight: () => 1,
  logLevel: "info" as EcleciaIndexerConfig["logLevel"],
  usePolling: false,
  pollingInterval: 5000,
  minimal: true,
  init: () => Promise.resolve(),
  beginTransaction: () => Promise.resolve(),
  endTransaction: (_status: boolean) => Promise.resolve()
};

export class EcleciaIndexer extends EclesiaEmitter {
  private config: EcleciaIndexerConfig;

  private fastify: FastifyInstance;

  private blockQueue: BlockQueue;

  private latestHeight!: number;

  private heightToProcess!: number;

  private initialized = false;

  public client!: CometClient;

  public log: winston.Logger;

  private healthCheck = {
    status: "CONNECTING"
  };

  constructor(config: EcleciaIndexerConfig) {
    super();
    this.config = {
      ...defaultIndexerConfig,
      ...config
    };
    if (!this.config.minimal) {
      this.blockQueue = new PromiseQueue<[BlockResponse, BlockResultsResponse]>(this.config.batchSize);
    } else {
      this.blockQueue = new PromiseQueue<[BlockResponse, BlockResultsResponse, Uint8Array]>(this.config.batchSize);
    }
    const { printf } = winston.format;

    const eclesiaFormat = printf(({ level, message, timestamp }) => {
      return `${timestamp} [${level.toUpperCase()}]:\t${message}`;
    });
    this.log = winston.createLogger({
      level: this.config.logLevel,
      defaultMeta: { service: "Eclesia Indexer" },
      transports: [
        new winston.transports.File({
          filename: "error.log",
          level: "error"
        }),
        new winston.transports.File({ filename: "combined.log" }),
        new winston.transports.Console({
          format: winston.format.combine(winston.format.splat(), winston.format.timestamp(), eclesiaFormat, winston.format.colorize({ all: true }))
        })
      ]
    });
    this.fastify = Fastify({
      logger: false
    });
    this.on("_unhandled", (msg) => {
      if (msg.uuid) {
        this.log.verbose("Unhandled event: " + msg.type);
        this.emit("uuid", {
          status: true,
          uuid: msg.uuid
        });
      }
    });
    this.fastify.get("/health", async(_request, reply) => {
      const code = this.healthCheck.status == "OK" ? 200 : 503;
      reply.code(code).send(this.healthCheck);
    });
    this.fastify.listen({
      port: 80,
      host: "0.0.0.0"
    }, (err) => {
      if (err) {
        this.fastify.log.error(err);
        process.exit(1);
      }
    });
  }

  private setStatus(status: string) {
    this.healthCheck.status = status;
  }

  private isMinimal(_blockqueue: BlockQueue): _blockqueue is MinimalBlockQueue {
    if (this.config.minimal) {
      return true;
    } else {
      return false;
    }
  }

  public async connect() {
    try {
      this.client = await connectComet(this.config.rpcUrl);
      this.log.info("Connected to RPC");
      return true;
    } catch (error) {
      this.log.error(error);
      return false;
    }
  }

  public async start() {
    if (!this.initialized) {
      try {
        if (this.config.init) {
          await this.config.init();
        }
        if (this.config.genesisPath) {
          await this.parseGenesis();
        }
      } catch (e) {
        this.log.error("Failed to initialize indexer: " + e);
        this.setStatus("FAILED");
        throw e;
      }
    }
    const status = await this.client.status();
    this.latestHeight = status.syncInfo.latestBlockHeight;
    this.blockQueue.clear();
    this.log.info("Current chain height: " + this.latestHeight);

    this.heightToProcess = await this.config.getNextHeight();
    if (this.config.usePolling) {
      this.pollForBlock();
    } else {
      this.client.subscribeNewBlock().addListener({
        next: (data) => {
          this.newBlockReceived(data.header.height);
        }
      });
    }
    try {
      this.fetcher();
    } catch (e) {
      this.log.error("" + e);
    }
    const hrTime = process.hrtime();
    let ms = hrTime[0] * 1000000 + hrTime[1] / 1000;
    while (this.blockQueue.size() > 0) {
      // await the dequeued promise is essentially awaiting fetched data for that block
      try {
        // Index block inside a db transaction to ensure data consistency
        await this.config.beginTransaction();
        this.log.debug("Started db tx");
        let height, timestamp;
        this.log.debug(this.isMinimal(this.blockQueue));
        if (this.isMinimal(this.blockQueue)) {
          const toProcess = await this.blockQueue.dequeue();
          this.log.debug("Retrieved block data");
          if (!toProcess) {
            throw new Error("Could not fetch block");
          }
          height = toProcess[0].block.header.height;
          timestamp = toRfc3339WithNanoseconds(toProcess[0].block.header.time);
          await this.processBlock(toProcess[0], toProcess[1]);
        } else {
          const toProcess = await this.blockQueue.dequeue();
          this.log.debug("Retrieved block data");
          if (!toProcess) {
            throw new Error("Could not fetch block");
          }

          this.log.debug("Decoded block");
          height = toProcess[0].block.header.height;
          timestamp = toRfc3339WithNanoseconds(toProcess[0].block.header.time);
          await this.processBlock(toProcess[0], toProcess[1], QueryValidatorsResponse.decode(toProcess[2]).validators);
        }
        // Emit events to trigger periodic operations every 50, 100 and 1000 blocks
        if (height % 1000 == 0) {
          const hrTime = process.hrtime();
          const newms = hrTime[0] * 1000000 + hrTime[1] / 1000;
          const duration = newms - ms;
          ms = newms;
          const rate = 1000000000 / duration;
          this.log.info("Processing:" + rate.toFixed(2) + "blocks/sec");
          await this.asyncEmit("periodic/1000", {
            value: null,
            height,
            timestamp
          });
        }
        if (height % 100 == 0) {
          await this.asyncEmit("periodic/100", {
            value: null,
            height,
            timestamp
          });
        }
        if (height % 50 == 0) {
          await this.asyncEmit("periodic/50", {
            value: null,
            height,
            timestamp
          });
        }
        this.log.debug("Handled periodic events");

        await this.config.endTransaction(true);

        this.log.debug("Committed db tx");
      } catch (e) {
        this.log.error("" + e);
        this.setStatus("FAILED");
        await this.config.endTransaction(false);
        break;
      }
    }
    this.start();
  }

  private asyncEmit: EmitFunc<keyof WithHeightAndUUID<EventMap>> = async(type,
    event) => {
    event.uuid = uuidv4();

    // More than 1 listener can be registered for an event type
    // Fortunately these are all set up during module init() so we have a consistent count
    // so we can count responses to resolve when complete
    // values are irrelevant as promise resolution is only used for flow control
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
              this.off("uuid", returnFunc);
              resolve();
            }
          } else {
            // At least 1 listener is reporting an error. Reject and handle exception at the original asyncEmit location
            reject(ev.error);
          }
        }
      };
      this.on("uuid", returnFunc);
    });
    this.emit(type, event);

    return prom;
  };

  private async processBlock(block: BlockResponse, block_results: BlockResultsResponse, validators?: Validator[]) {

    const height = block.block.header.height;
    this.log.debug("Processing block: ", height);
    this.log.debug("Started db tx");

    // Initialize height & timestamp to be used for this block-processing run
    const timestamp = toRfc3339WithNanoseconds(block.block.header.time);

    // Use & await asyncEmit to ensure db insertions in order

    // Emit block information to any interested modules.
    // Primarily the required block module listens to this
    await this.asyncEmit("block", {
      value: {
        block,
        block_results
      },
      height,
      timestamp
    });
    this.log.debug("Modules handled block event");

    // Deal with begin_block events first
    await this.asyncEmit("begin_block", {
      value: {
        events: block_results.beginBlockEvents,
        validators
      },
      height,
      timestamp
    });

    this.log.debug("Modules handled begin_block events");

    // Then individual tx_events
    await this.asyncEmit("tx_events", {
      value: block_results.results,
      height,
      timestamp
    });
    this.log.debug("Modules handled tx events");

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
        const txHash = createHash("sha256").update(block.block.txs[t]).digest("hex");
        await this.asyncEmit("tx_memo", {
          value: {
            txHash,
            txBody: tx.body
          },
          height,
          timestamp
        });
      }
      // parsing log rather than using events directly in order to have msg_index available to filter appropriate events for each msg
      const events: Array<{
        msg_index?: number;
        events: Event[];
      }> = txlog
        ? JSON.parse(txlog)
        : [];
      const msgs = tx.body?.messages;

      if (msgs) {
        for (let i = 0; i < msgs.length; i++) {
          this.log.debug("Indexer broadcasting msg for handling: " + msgs[i].typeUrl);
          const msgevents =
            msgs.length > 1
              ? events.find((x) => x.msg_index == i)?.events
              : events[0].events;
          await this.asyncEmit(msgs[i].typeUrl as never, {
            value: {
              tx: msgs[i].value as never,
              events: msgevents
            } as never,
            height,
            timestamp
          });
          if (msgs[i].typeUrl == "/cosmos.authz.v1beta1.MsgExec") {
            const authzMsgs = MsgExec.decode(msgs[i].value).msgs;
            if (authzMsgs) {
              for (let r = 0; r < authzMsgs.length; r++) {
                this.log.debug("Indexer broadcasting msg for handling: " + authzMsgs[i].typeUrl);
                const authzMsgEvents = msgevents?.reduce((events, evt) => {
                  if (evt.attributes.filter(x => decodeAttr(x.key) == "authz_msg_index" && decodeAttr(x.value) == "" + r).length > 0) {
                    events.push(evt);
                  }
                  return events;
                }, [] as Event[]);
                await this.asyncEmit(authzMsgs[i].typeUrl as never, {
                  value: {
                    tx: authzMsgs[i].value as never,
                    events: authzMsgEvents
                  } as never,
                  height,
                  timestamp
                });
              }
            }
          }
        }
      }
    }
    this.log.debug("Modules handled msg events");

    // Then deal with end_block events
    await this.asyncEmit("end_block", {
      value: block_results.endBlockEvents,
      height,
      timestamp
    });
    this.log.debug("Modules handled end_block events");
  }

  private async fetcher() {
    let error = false;
    for (let i = this.heightToProcess; i <= this.latestHeight; i++) {
      this.log.debug("Fetching: " + i);
      try {
        if (this.isMinimal(this.blockQueue)) {
          const toIndex = Promise.all([
            this.client.block(i) as Promise<BlockResponse>,
            this.client.blockResults(i) as Promise<BlockResultsResponse>
          ]);

          this.blockQueue.enqueue(toIndex);
        } else {
          const q = QueryValidatorsRequest.fromPartial({});
          const vals = QueryValidatorsRequest.encode(q).finish();
          const toIndex = Promise.all([
            this.client.block(i) as Promise<BlockResponse>,
            this.client.blockResults(i) as Promise<BlockResultsResponse>,
            this.callABCI("/cosmos.staking.v1beta1.Query/Validators", vals, i)
          ]);

          this.blockQueue.enqueue(toIndex);
        }
        await this.blockQueue.continue();
      } catch (e) {
        this.log.error(e);
        error = true;
        break;
      }
    }
    if (!error) {
      this.blockQueue.setSynced();
      this.log.info("Synced to latest height");
    }
  }

  public async callABCI(path: string, data: Uint8Array, height?: number) {
    const timeout: Promise<void> = new Promise((resolve) => {
      setTimeout(resolve, 30000);
    });
    const abciq = await Promise.race([
      this.client.abciQuery({
        path,
        data,
        height: height
      }),
      timeout
    ]);
    if (abciq) {
      return abciq.value;
    } else {
      this.setStatus("FAILED");
      throw new Error("RPC not responding");
    }
  }

  private newBlockReceived(height: number): void {
    this.log.info("Received new block: %d", height);

    // If we are synced, add to end of queue
    if (this.blockQueue.synced) {
      try {
        if (this.isMinimal(this.blockQueue)) {
          this.blockQueue.enqueue(Promise.all([
            this.client.block(height) as Promise<BlockResponse>,
            this.client.blockResults(height) as Promise<BlockResultsResponse>
          ]));
        } else {
          const q = QueryValidatorsRequest.fromPartial({});
          const vals = QueryValidatorsRequest.encode(q).finish();
          this.blockQueue.enqueue(Promise.all([
            this.client.block(height) as Promise<BlockResponse>,
            this.client.blockResults(height) as Promise<BlockResultsResponse>,
            this.callABCI("/cosmos.staking.v1beta1.Query/Validators", vals, height)
          ]));
        }
      } catch (e) {
        this.log.error("" + e);
      }
    } else {
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
    }, this.config.pollingInterval);
  }

  private readGenesis(): Parser {
    if (this.config.genesisPath) {
      return fs.createReadStream(this.config.genesisPath).pipe(parser());
    } else {
      throw new Error("Genesis path not set");
    }
  }

  private async setArrayReader(path: string, processor: (chunk: unknown) => Promise<void>): Promise<boolean> {
    const readPromise = new Promise<boolean>((resolve, reject) => {
      try {
        const filters = path.split(".");
        const pickers = filters.map((filter) => pick({ filter }));
        let counter = 0;
        chain([this.readGenesis(), ...pickers, streamArray(), processor])
          .on("data", (_data) => {
            counter++;
          })
          .on("end", () => {
            this.log.info(`Processed ${counter} entries`);
            resolve(true);
          });
      } catch (_e) {
        reject();
      }
    });

    return readPromise;
  }

  private async setValueReader(path: string, processor: (chunk: unknown) => Promise<void>): Promise<boolean> {
    const readPromise = new Promise<boolean>((resolve, reject) => {
      try {
        const filters = path.split(".");
        const pickers = filters.map((filter) => pick({ filter }));

        let counter = 0;
        chain([this.readGenesis(), ...pickers, streamValues(), processor])
          .on("data", (_data) => {
            counter++;
          })
          .on("end", () => {
            this.log.info(`Processed ${counter} entries`);
            resolve(true);
          });
      } catch (_e) {
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await this.setArrayReader(genesisEntry[2], async(data: any) => {
              await this.asyncEmit(key as never, { value: data.value } as never);
            });
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await this.setValueReader(genesisEntry[2], async(data: any) => {
              await this.asyncEmit(key as never, { value: data.value } as never);
            });
          }
        }
      }

      this.log.info("Importing gen TXs...");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.setArrayReader("app_state.genutil.gen_txs", async(data: any) => {
        for (let i = 0; i < data.value.body.messages.length; i++) {
          const msg = data.value.body.messages[i];
          await this.asyncEmit(("gentx" + msg["@type"]) as never, { value: msg } as never);
        }

        return data;
      });
      await this.config.endTransaction(true);

      this.log.info("Finished importing");
    } catch (e) {
      await this.config.endTransaction(false);
      this.log.error("Failed to import genesis");
      throw e;
    }
  }
}