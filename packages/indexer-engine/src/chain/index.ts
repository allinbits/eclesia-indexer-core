/* eslint-disable @stylistic/no-multi-spaces */
import type * as winston from "winston";

import type {
  IndexerMetrics,
} from "../metrics/index.js";
import type {
  EmitFunc, WithHeightAndUUID,
} from "../types/index.js";

/**
 * Everything the engine needs to know about one fetched block, independent of the chain.
 * `data` is whatever the adapter chose to fetch for the height (block, results, validators...)
 * and is handed back untouched to `processBlock`.
 */
export type FetchedBlock<TBlock> = {
  height: number      // Block height
  timestamp: string   // Block time as an RFC 3339 string (with nanoseconds where the chain has them)
  data: TBlock        // Chain-specific payload
};

/** What the engine reads from a node's status call */
export type ChainStatus = {
  network: string       // Chain / network id as reported by the node
  latestHeight: number  // Height of the latest block the node has
};

/** Listener the engine attaches to a block subscription. Only the height is needed. */
export type BlockListener = {
  next: (height: number) => void
  error: (error: unknown) => void
  complete: () => void
};

/** Detaches a block listener from its subscription */
export type Unsubscribe = () => void;

/** Reply to an ABCI-style query. A non-zero code means the chain answered "no". */
export type AbciResult = {
  code: number
  log?: string
  value: Uint8Array
};

/** Handed to `fetchBlock`: logging, metrics and the mode the indexer runs in */
export type FetchContext = {
  log: winston.Logger
  prometheus: IndexerMetrics | null
  minimal: boolean    // Lightweight mode: the adapter may skip expensive per-block data (validator sets...)
};

/** Handed to `processBlock`: the emitter plus the height and timestamp every event must carry */
export type ProcessContext = {
  emit: EmitFunc<keyof WithHeightAndUUID<EventMap>>
  log: winston.Logger
  prometheus: IndexerMetrics | null
  height: number
  timestamp: string
  minimal: boolean
};

/**
 * Handed to `genesis`: streaming readers over the genesis file plus the emitter. The engine has
 * already streamed every `genesis/array/<path>` and `genesis/value/<path>` a module registered
 * for; this hook is for chain-specific extras such as Cosmos gentxs.
 */
export type GenesisContext = {
  emit: EmitFunc<keyof WithHeightAndUUID<EventMap>>
  log: winston.Logger
  /** Streams the JSON array at `path` (dot separated, e.g. `app_state.genutil.gen_txs`) in chunks */
  streamArray: (path: string, processor: (chunk: unknown[]) => Promise<void>) => Promise<boolean>
  /** Streams the single JSON value at `path` */
  streamValue: (path: string, processor: (value: unknown) => Promise<void>) => Promise<boolean>
  /** Event names that have at least one handler, so the adapter can skip work nobody listens to */
  handled: ReadonlyMap<string, number>
};

/**
 * The contract a chain implements to run on the engine. The engine owns timeouts, retries,
 * recovery, the block queue, transactions, metrics and health; the adapter owns the RPC
 * client, what a block is, and how it decomposes into events.
 *
 * `TClient` is the adapter's RPC client type, exposed to modules through `indexer.client`.
 * `TBlock` is the payload `fetchBlock` produces and `processBlock` consumes.
 */
export interface ChainAdapter<TClient = unknown, TBlock = unknown> {
  /** Short identifier, used in logs and errors (e.g. "cosmos", "gno") */
  readonly name: string

  /** Opens a client for the RPC endpoint. Called twice: one client for ad-hoc queries, one for the block pipeline. */
  connect(url: string): Promise<TClient>

  /** Closes a client. Must not throw on an already closed client. */
  disconnect(client: TClient): void | Promise<void>

  /** Network id and latest height as the node reports them */
  status(client: TClient): Promise<ChainStatus>

  /**
   * Subscribes to new-block announcements and returns a function that detaches the listener.
   * Leave undefined when the chain's RPC has no push channel: the engine then polls `status`.
   * Return `null` when this particular client cannot subscribe (an HTTP endpoint, say); the
   * engine then switches the run to polling.
   */
  subscribeNewBlock?(client: TClient, listener: BlockListener): Unsubscribe | null

  /** Fetches everything `processBlock` needs for one height. Throw on any failure; the engine retries. */
  fetchBlock(client: TClient, height: number, ctx: FetchContext): Promise<FetchedBlock<TBlock>>

  /**
   * Decomposes a fetched block into events, awaiting `ctx.emit` for each so module handlers run
   * in order inside the block's database transaction.
   */
  processBlock(block: FetchedBlock<TBlock>, ctx: ProcessContext): Promise<void>

  /** ABCI-style state query, when the chain has one. Backs `indexer.callABCI`. */
  abciQuery?(client: TClient, path: string, data: Uint8Array, height?: number): Promise<AbciResult>

  /** Chain-specific genesis import steps, run after the generic `genesis/*` streams inside the genesis transaction */
  genesis?(ctx: GenesisContext): Promise<void>
}

/** The client type of an adapter */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClientOf<A> = A extends ChainAdapter<infer C, any> ? C : never;

/** The block payload type of an adapter */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BlockOf<A> = A extends ChainAdapter<any, infer B> ? B : never;
