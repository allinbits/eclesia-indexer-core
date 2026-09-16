import {
  createHash,
} from "node:crypto";

import {
  BlockResponse, BlockResultsResponse, CometClient, connectComet, Event, NewBlockEvent, toRfc3339WithNanoseconds,
} from "@cosmjs/tendermint-rpc";
import {
  BlockResultsResponse as BlockResultsResponse38, Event as Event38,
} from "@cosmjs/tendermint-rpc/build/comet38/responses.js";
import {
  AbciResult, BlockListener, ChainAdapter, FetchContext, FetchedBlock, GenesisContext, PAGINATION_LIMITS, ProcessContext, RPCError, Unsubscribe, Utils,
} from "@eclesia/indexer-engine";
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

import {
  CosmosBlock,
} from "./types.js";

/** Options for the Cosmos chain adapter */
export type CosmosAdapterOptions = {
  /**
   * Builds the RPC client for an endpoint. Defaults to cosmjs' connectComet, which detects the
   * CometBFT version. Supply your own to use an HTTP batch client, add headers, or plug in a
   * mock node in tests.
   */
  connect?: (url: string) => Promise<CometClient>
};

/**
 * Chain adapter for Cosmos SDK chains running CometBFT 0.34, 0.37 or 0.38. Fetches blocks and
 * results through cosmjs, plus the complete validator set in full mode, and decomposes each
 * block into the events the Cosmos modules listen to: `block`, `begin_block`, `tx_events`,
 * `tx_memo`, one event per message type URL (authz MsgExec unwrapped), and `end_block`.
 */
export class CosmosAdapter implements ChainAdapter<CometClient, CosmosBlock> {
  readonly name = "cosmos";

  private readonly options: CosmosAdapterOptions;

  constructor(options: CosmosAdapterOptions = {
  }) {
    this.options = options;
  }

  connect(url: string): Promise<CometClient> {
    return this.options.connect ? this.options.connect(url) : connectComet(url);
  }

  disconnect(client: CometClient): void {
    client.disconnect();
  }

  async status(client: CometClient) {
    const status = await client.status();
    return {
      network: status.nodeInfo.network,
      latestHeight: status.syncInfo.latestBlockHeight,
    };
  }

  /**
   * Subscribes over the client's WebSocket. cosmjs HTTP clients cannot subscribe and throw
   * synchronously; that is reported as `null` so the engine falls back to polling.
   */
  subscribeNewBlock(client: CometClient, listener: BlockListener): Unsubscribe | null {
    let stream: ReturnType<CometClient["subscribeNewBlock"]>;
    try {
      stream = client.subscribeNewBlock();
    }
    catch (_e) {
      return null;
    }
    const streamListener = {
      next: (event: NewBlockEvent) => listener.next(event.header.height),
      error: (error: unknown) => listener.error(error),
      complete: () => listener.complete(),
    };
    stream.addListener(streamListener);
    return () => {
      stream.removeListener(streamListener);
    };
  }

  async fetchBlock(client: CometClient, height: number, ctx: FetchContext): Promise<FetchedBlock<CosmosBlock>> {
    // cosmjs types these as unions over CometBFT versions; the adapter handles the 0.37 and 0.38 shapes
    const [block, blockResults, validators] = await Promise.all([client.block(height) as Promise<BlockResponse>, client.blockResults(height) as Promise<BlockResultsResponse | BlockResultsResponse38>, ctx.minimal ? Promise.resolve(undefined) : this.fetchValidatorSet(client, height, ctx)]);
    return {
      height: block.block.header.height,
      timestamp: toRfc3339WithNanoseconds(block.block.header.time),
      data: {
        block,
        blockResults,
        validators,
      },
    };
  }

  async abciQuery(client: CometClient, path: string, data: Uint8Array, height?: number): Promise<AbciResult> {
    const reply = await client.abciQuery({
      path,
      data,
      height,
    });
    return {
      code: reply.code ?? 0,
      log: reply.log,
      value: reply.value,
    };
  }

  /**
   * Fetches the complete validator set at a height, following pagination. Chains with more
   * validators than one page (1000) were silently truncated before.
   */
  async fetchValidatorSet(client: CometClient, height: number, ctx: Pick<FetchContext, "prometheus">): Promise<Validator[]> {
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
        await this.pipelineQuery(client, "/cosmos.staking.v1beta1.Query/Validators", QueryValidatorsRequest.encode(request).finish(), height, ctx),
      );
      validators.push(...page.validators);
      key = page.pagination?.nextKey && page.pagination.nextKey.length > 0 ? page.pagination.nextKey : undefined;
    } while (key);
    return validators;
  }

  /**
   * ABCI query for the block pipeline. A non-zero code is thrown, so the fetch fails and the
   * engine requests a recovery, instead of decoding an error reply as an empty result.
   */
  private async pipelineQuery(client: CometClient, path: string, data: Uint8Array, height: number, ctx: Pick<FetchContext, "prometheus">): Promise<Uint8Array> {
    const endTimer = ctx.prometheus?.timeRpcCall(path) ?? void 0;
    try {
      const reply = await this.abciQuery(client, path, data, height);
      if (reply.code) {
        throw new RPCError("ABCI query " + path + " failed with code " + reply.code + (reply.log ? ": " + reply.log : ""));
      }
      return reply.value;
    }
    finally {
      endTimer?.();
    }
  }

  async processBlock(fetched: FetchedBlock<CosmosBlock>, ctx: ProcessContext): Promise<void> {
    const {
      block, blockResults: block_results, validators,
    } = fetched.data;
    const {
      emit, log, height, timestamp,
    } = ctx;

    // Use & await emit to ensure db insertions in order

    /*
     * Emit block information to any interested modules.
     * Primarily the required block module listens to this
     */
    await emit("block",
      {
        value: {
          block,
          block_results,
        },
        height,
        timestamp,
      });
    log.silly("Modules handled block event");

    let beginBlockEvents: readonly Event[] | readonly Event38[];
    let endBlockEvents: readonly Event[] | readonly Event38[];
    if ((block_results as BlockResultsResponse38).finalizeBlockEvents) {
      // Cosmos SDK 0.50+ tags each finalize_block event with mode=BeginBlock / mode=EndBlock (baseapp.go)
      beginBlockEvents = (block_results as BlockResultsResponse38).finalizeBlockEvents.filter(x => Utils.hasBlockEventMode(x, "BeginBlock")) as readonly Event38[];
      endBlockEvents = (block_results as BlockResultsResponse38).finalizeBlockEvents.filter(x => Utils.hasBlockEventMode(x, "EndBlock")) as readonly Event38[];
    }
    else {
      beginBlockEvents = (block_results as BlockResultsResponse).beginBlockEvents;
      endBlockEvents = (block_results as BlockResultsResponse).endBlockEvents;
    }
    // Deal with begin_block events first
    await emit("begin_block",
      {
        value: {
          events: beginBlockEvents!,
          validators,
        },
        height,
        timestamp,
      });

    log.silly("Modules handled begin_block events");

    // Then individual tx_events
    await emit("tx_events",
      {
        value: block_results.results,
        height,
        timestamp,
      });
    log.silly("Modules handled tx events");

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
        await emit("tx_memo",
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
          log.silly("Tx log is not JSON, using msg_index attributes instead");
        }
      }
      if (events.length == 0) {
        const eventsToAdd: typeof events = [];
        log.silly("No events found in tx log. Parsing events for msg_index");
        for (let m = 0; m < block_results.results[t].events.length; m++) {
          if (block_results.results[t].events[m].attributes.find(a => Utils.decodeAttr(a.key) == "msg_index")) {
            const mi = Utils.decodeAttr(block_results.results[t].events[m].attributes.find(a => Utils.decodeAttr(a.key) == "msg_index")?.value ?? "");
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
          if (log.isSillyEnabled()) {
            log.silly("Indexer broadcasting msg for handling: " + msgs[i].typeUrl);
          }
          const msgevents
            = msgs.length > 1
              ? events.find(x => x.msg_index == i)?.events
              : events[0]?.events ?? [];
          await emit(msgs[i].typeUrl as never,
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
                if (log.isSillyEnabled()) {
                  log.silly("Indexer broadcasting msg for handling: " + authzMsgs[r].typeUrl);
                }
                const authzMsgEvents = msgevents?.reduce((events, evt) => {
                  if (evt.attributes.filter(x => Utils.decodeAttr(x.key) == "authz_msg_index" && Utils.decodeAttr(x.value) == "" + r).length > 0) {
                    events.push(evt);
                  }
                  return events;
                },
                [] as (Event | Event38)[]);
                await emit(authzMsgs[r].typeUrl as never,
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
    log.silly("Modules handled msg events");
    ctx.prometheus?.recordTransactions(block.block.txs.length);
    // Then deal with end_block events
    await emit("end_block",
      {
        value: endBlockEvents!,
        height,
        timestamp,
      });
    log.silly("Modules handled end_block events");
  }

  /**
   * Genesis transactions: every message of every gentx is emitted as `gentx<typeUrl>` (for
   * example `gentx/cosmos.staking.v1beta1.MsgCreateValidator`) so the staking module can seed
   * validators and their self-delegations.
   */
  async genesis(ctx: GenesisContext): Promise<void> {
    ctx.log.info("Importing gen TXs...");
    await ctx.streamArray("app_state.genutil.gen_txs", async (gentxs) => {
      for (const gentx of gentxs as Array<{
        body: {
          messages: Array<{
            "@type": string
          }>
        }
      }>) {
        for (const msg of gentx.body.messages) {
          await ctx.emit(("gentx" + msg["@type"]) as never,
            {
              value: msg,
            } as never);
        }
      }
    });
  }
}

/**
 * Builds the Cosmos chain adapter.
 * @param options - Optional custom client factory
 */
export function cosmos(options: CosmosAdapterOptions = {
}): CosmosAdapter {
  return new CosmosAdapter(options);
}
