import {
  createHash,
} from "node:crypto";

import {
  AbciResult, ChainAdapter, FetchContext, FetchedBlock, GenesisContext, ProcessContext,
} from "@eclesia/indexer-engine";
import {
  BlockResultsResponse, HttpClient, RpcClient, Tm2Client, toRfc3339WithNanoseconds, TxResult, Validator, WebsocketClient,
} from "@gnolang/tm2-rpc";

import {
  decodeBlockResults, RawBlockResults,
} from "./block-results.js";
import {
  decodeTx, MessageDecoder, messageDecoders,
} from "./messages.js";
import {
  RateLimiter, throttledRpcClient,
} from "./rate-limit.js";
import {
  BatchingHttpClient, BatchOptions,
} from "./transport.js";
import {
  GenesisTx, GnoBlock, GnoTx, GnoTxError,
} from "./types.js";

/** Options for the gno chain adapter */
export type GnoAdapterOptions = {
  /**
   * Builds the RPC client for an endpoint. Defaults to tm2-rpc's connectTm2. Supply your own to
   * use a batch client, add headers, or plug in a mock node in tests.
   */
  connect?: (url: string) => Promise<Tm2Client>
  /** Extra message decoders by type URL, for forks with their own messages; override built-ins by URL */
  decoders?: Record<string, MessageDecoder>
  /**
   * Cap on JSON-RPC calls per second across every client this adapter opens. Public endpoints
   * such as rpc.gno.land block bursts; a full-mode indexer makes three calls per block. Only
   * applies to clients the adapter builds itself (not with a custom `connect`).
   */
  requestsPerSecond?: number
  /** Extra HTTP headers for the RPC transport (API keys, a User-Agent); ignored with a custom `connect` */
  headers?: Record<string, string>
  /**
   * Pack concurrent JSON-RPC calls into one HTTP request each (Tendermint2 accepts batches).
   * Defaults to on when `requestsPerSecond` is set, since that limit counts HTTP requests and
   * batching multiplies what fits under it. Pass `false` to send one call per request, or an
   * object to tune the batch size and dispatch interval. Ignored with a custom `connect`.
   */
  batching?: boolean | BatchOptions
};

/**
 * Chain adapter for gno.land and other Tendermint2 chains. Fetches blocks and results through
 * tm2-rpc, plus the validator set in full mode, and decomposes each block into `block`,
 * `begin_block`, one `tx` per transaction, one event per decoded message (named after its
 * amino type URL: /bank.MsgSend, /vm.m_call, /vm.m_addpkg, /vm.m_run) and `end_block`.
 *
 * tm2-rpc has no block subscription, so the engine polls the node for new heights.
 */
export class GnoAdapter implements ChainAdapter<Tm2Client, GnoBlock> {
  readonly name = "gno";

  private readonly options: GnoAdapterOptions;

  private readonly decoders: Record<string, MessageDecoder>;

  private readonly limiter: RateLimiter | null;

  /** Message types seen without a decoder, warned about once each */
  private readonly unknownTypes = new Set<string>();

  /** Transports of the clients this adapter built, for raw calls that bypass tm2-rpc's decoders */
  private readonly transports = new WeakMap<Tm2Client, RpcClient>();

  private requestId = 0;

  /** Validator set last fetched, keyed by the header's validatorsHash; the set rarely changes */
  private validatorCache: {
    hash: string
    validators: readonly Validator[]
  } | null = null;

  constructor(options: GnoAdapterOptions = {
  }) {
    this.options = options;
    this.decoders = {
      ...messageDecoders,
      ...options.decoders,
    };
    this.limiter = options.requestsPerSecond ? new RateLimiter(options.requestsPerSecond) : null;
  }

  /**
   * Opens a client on a transport the adapter builds itself (HTTP, batching HTTP, or WebSocket
   * for ws:// URLs), so it can also issue raw calls; a custom `connect` takes over entirely.
   */
  async connect(url: string): Promise<Tm2Client> {
    if (this.options.connect) {
      return this.options.connect(url);
    }
    const transport = this.buildTransport(url);
    const client = await Tm2Client.create(transport);
    this.transports.set(client, transport);
    return client;
  }

  private buildTransport(url: string): RpcClient {
    const headers = this.options.headers ?? {
    };
    const isHttp = url.startsWith("http://") || url.startsWith("https://");
    const batching = this.options.batching ?? this.limiter !== null;
    if (isHttp && batching) {
      return new BatchingHttpClient(url, headers, typeof batching === "object"
        ? batching
        : {
        }, this.limiter);
    }
    const base: RpcClient = isHttp
      ? new HttpClient({
        url,
        headers,
      })
      : new WebsocketClient(url);
    return this.limiter ? throttledRpcClient(base, this.limiter) : base;
  }

  /**
   * Block results, decoded here rather than by tm2-rpc: its event decoder requires a realm
   * `pkg_path` on every event and throws on the bank module's `/bank.TransferEvent`, which
   * every plain transfer on gno.land emits. Clients from a custom `connect` (mocks) decode
   * their own results.
   */
  private async blockResults(client: Tm2Client, height: number): Promise<BlockResultsResponse> {
    const transport = this.transports.get(client);
    if (!transport) {
      return client.blockResults(height);
    }
    const reply = await transport.execute({
      jsonrpc: "2.0",
      id: "eclesia-" + (++this.requestId),
      method: "block_results",
      params: {
        height: String(height),
      },
    } as Parameters<RpcClient["execute"]>[0]);
    return decodeBlockResults(reply.result as RawBlockResults);
  }

  disconnect(client: Tm2Client): void {
    client.disconnect();
  }

  async status(client: Tm2Client) {
    const status = await client.status();
    return {
      network: status.nodeInfo.network,
      latestHeight: status.syncInfo.latestBlockHeight,
    };
  }

  async fetchBlock(client: Tm2Client, height: number, ctx: FetchContext): Promise<FetchedBlock<GnoBlock>> {
    const [block, blockResults] = await Promise.all([client.block(height), this.blockResults(client, height)]);
    // The header commits to the validator set, so a block whose validatorsHash matches the last
    // fetched set needs no validators call: full mode costs two RPC calls per block, not three
    const validators = ctx.minimal ? undefined : await this.validatorsAt(client, height, block.block.header.validatorsHash, ctx);
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

  /** Validator set for a height, served from the cache when the header's validatorsHash matches */
  private async validatorsAt(client: Tm2Client, height: number, validatorsHash: Uint8Array, ctx: Pick<FetchContext, "prometheus">): Promise<readonly Validator[]> {
    const hash = Buffer.from(validatorsHash).toString("hex");
    if (this.validatorCache && this.validatorCache.hash === hash && hash !== "") {
      return this.validatorCache.validators;
    }
    const validators = await this.fetchValidators(client, height, ctx);
    if (hash !== "") {
      this.validatorCache = {
        hash,
        validators,
      };
    }
    return validators;
  }

  /** Validator set at a height. tm2-rpc does not decode end-block validator updates, so full mode asks the node. */
  async fetchValidators(client: Tm2Client, height: number, ctx: Pick<FetchContext, "prometheus">): Promise<readonly Validator[]> {
    const endTimer = ctx.prometheus?.timeRpcCall("validators") ?? void 0;
    try {
      return (await client.validators({
        height,
      })).validators;
    }
    finally {
      endTimer?.();
    }
  }

  /**
   * ABCI query. Tendermint2 reports failures as a typed error object instead of a numeric code;
   * it is mapped to code 1 with the error's type and message in `log`, so `indexer.callABCI`
   * keeps its "non-zero code means the chain said no" semantics.
   */
  async abciQuery(client: Tm2Client, path: string, data: Uint8Array, height?: number): Promise<AbciResult> {
    const reply = await client.abciQuery({
      path,
      data,
      height,
    });
    const error = (reply.responseBase.error ?? null) as GnoTxError | null;
    return {
      code: error ? 1 : 0,
      log: error ? error["@type"] + ": " + error.value : reply.responseBase.log,
      value: reply.value,
    };
  }

  async processBlock(fetched: FetchedBlock<GnoBlock>, ctx: ProcessContext): Promise<void> {
    const {
      block, blockResults, validators,
    } = fetched.data;
    const {
      emit, log, height, timestamp,
    } = ctx;

    await emit("block", {
      value: {
        block,
        block_results: blockResults,
        validators,
      },
      height,
      timestamp,
    });
    log.silly("Modules handled block event");

    await emit("begin_block", {
      value: {
        events: blockResults.results.beginBlock?.responseBase?.events ?? [],
        validators,
      },
      height,
      timestamp,
    });
    log.silly("Modules handled begin_block events");

    const results = blockResults.results.deliverTx ?? [];
    for (let i = 0; i < block.block.txs.length; i++) {
      const tx = decodeGnoTx(block.block.txs[i], i, results[i]);
      await emit("tx", {
        value: tx,
        height,
        timestamp,
      });
      if (!tx.success) {
        // A failed transaction changed no state: its messages are not handed to modules
        continue;
      }
      for (let m = 0; m < tx.messages.length; m++) {
        const message = tx.messages[m];
        const decoder = this.decoders[message.typeUrl];
        if (!decoder) {
          if (!this.unknownTypes.has(message.typeUrl)) {
            this.unknownTypes.add(message.typeUrl);
            log.warn("No decoder for message type " + message.typeUrl + " (first seen in tx " + tx.hash + "); its messages are kept raw in the tx event and skipped as events. Add one through the adapter's decoders option.");
          }
          continue;
        }
        if (log.isSillyEnabled()) {
          log.silly("Indexer broadcasting msg for handling: " + message.typeUrl);
        }
        await emit(message.typeUrl as never, {
          value: {
            msg: decoder.decode(message.value),
            txHash: tx.hash,
            msgIndex: m,
            events: tx.events,
            tx,
          },
          height,
          timestamp,
        } as never);
      }
    }
    log.silly("Modules handled tx and msg events");
    ctx.prometheus?.recordTransactions(block.block.txs.length);

    await emit("end_block", {
      value: blockResults.results.endBlock?.responseBase?.events ?? [],
      height,
      timestamp,
    });
    log.silly("Modules handled end_block events");
  }

  /**
   * Genesis transactions: every message of every entry in `app_state.txs` is emitted as
   * `gentx<@type>` (for example `gentx/vm.m_addpkg`) with the transaction's metadata, so the
   * packages module sees realms deployed at genesis. Skipped when nothing listens for them.
   */
  async genesis(ctx: GenesisContext): Promise<void> {
    if (![...ctx.handled.keys()].some(key => key.startsWith("gentx"))) {
      ctx.log.verbose("No gentx handlers registered, skipping genesis transactions");
      return;
    }
    ctx.log.info("Importing genesis transactions...");
    await ctx.streamArray("app_state.txs", async (entries) => {
      for (const entry of entries as GenesisTx[]) {
        const msgs = entry.tx?.msg ?? [];
        for (let i = 0; i < msgs.length; i++) {
          await ctx.emit(("gentx" + msgs[i]["@type"]) as never, {
            value: {
              msg: msgs[i],
              msgIndex: i,
              tx: entry.tx,
              metadata: entry.metadata ?? null,
            },
          } as never);
        }
      }
    });
  }
}

/**
 * Decodes one raw transaction and joins it with its execution result. The hash is the sha256 of
 * the raw bytes in upper-case hex, which is how gnoland and gnoweb display it.
 */
export function decodeGnoTx(raw: Uint8Array, index: number, result: TxResult | undefined): GnoTx {
  const tx = decodeTx(raw);
  // tm2-rpc types the error as always present; the node sends null on success
  const error = (result?.responseBase.error ?? null) as GnoTxError | null;
  return {
    hash: createHash("sha256").update(raw).digest("hex").toUpperCase(),
    index,
    success: result !== undefined && error === null,
    error,
    gasWanted: result?.gasWanted ?? 0n,
    gasUsed: result?.gasUsed ?? 0n,
    fee: tx.fee,
    memo: tx.memo,
    messages: tx.messages,
    signatures: tx.signatures,
    events: result?.responseBase.events ?? [],
    log: result?.responseBase.log ?? "",
    info: result?.responseBase.info ?? "",
    raw,
  };
}

/**
 * Builds the gno chain adapter.
 * @param options - Optional custom client factory and extra message decoders
 */
export function gno(options: GnoAdapterOptions = {
}): GnoAdapter {
  return new GnoAdapter(options);
}
