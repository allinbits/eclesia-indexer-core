/* eslint-disable @stylistic/no-multi-spaces */
import {
  AbciResult, BlockListener, ChainAdapter, FetchContext, FetchedBlock, GenesisContext, ProcessContext, Unsubscribe,
} from "../chain/index.js";

/** Block payload produced by the synthetic chain */
export type SyntheticBlock = {
  height: number
  txs: number   // Number of synthetic transactions in the block
};

/** In-memory "node" the synthetic chain adapter talks to */
export class SyntheticClient {
  /** Height the node reports as its latest */
  public latestHeight: number;

  /** Network id the node reports */
  public network: string;

  /** Whether the client has been disconnected */
  public disconnected = false;

  /** Listeners attached through subscribeNewBlock */
  public listeners = new Set<BlockListener>();

  /** Heights that were fetched, in order */
  public fetched: number[] = [];

  /** Optional ABCI answerer, so tests can script replies per path */
  public abci?: (path: string, data: Uint8Array, height?: number) => Promise<AbciResult>;

  /** Optional status override, so tests can make the node fail or lie */
  public statusOverride?: () => Promise<{
    network: string
    latestHeight: number
  }>;

  constructor(network: string, latestHeight: number) {
    this.network = network;
    this.latestHeight = latestHeight;
  }

  /** Announces a new block to every subscribed listener, as a node would */
  announce(height: number): void {
    this.latestHeight = Math.max(this.latestHeight, height);
    for (const listener of this.listeners) {
      listener.next(height);
    }
  }

  /** Completes every subscription, as a closing socket would */
  closeSubscriptions(): void {
    for (const listener of [...this.listeners]) {
      listener.complete();
    }
  }
}

export type SyntheticChainOptions = {
  network?: string                                   // Network id (default: "synthetic-1")
  latestHeight?: number                              // Latest height of the node (default: 100)
  txsPerBlock?: number                               // Transactions per synthetic block (default: 0)
  subscriptions?: boolean                            // Whether the adapter offers subscribeNewBlock (default: true)
  connect?: (url: string) => Promise<SyntheticClient>  // Custom client factory (default: a fresh SyntheticClient per call)
  onProcess?: (block: FetchedBlock<SyntheticBlock>, ctx: ProcessContext) => Promise<void>  // Runs inside processBlock
  onGenesis?: (ctx: GenesisContext) => Promise<void> // Chain-specific genesis steps
};

/**
 * A chain adapter with no network behind it, for the engine's own tests and benchmarks. Every
 * fetch succeeds instantly and processBlock emits nothing unless `onProcess` is given, so what
 * it measures is the engine: scheduling, queueing, recovery and the transaction lifecycle.
 */
export class SyntheticChain implements ChainAdapter<SyntheticClient, SyntheticBlock> {
  readonly name = "synthetic";

  private options: SyntheticChainOptions;

  /** Every client this adapter connected, in order */
  public clients: SyntheticClient[] = [];

  subscribeNewBlock?: (client: SyntheticClient, listener: BlockListener) => Unsubscribe | null;

  constructor(options: SyntheticChainOptions = {
  }) {
    this.options = options;
    if (options.subscriptions !== false) {
      this.subscribeNewBlock = (client, listener) => {
        client.listeners.add(listener);
        return () => {
          client.listeners.delete(listener);
        };
      };
    }
  }

  async connect(url: string): Promise<SyntheticClient> {
    const client = this.options.connect
      ? await this.options.connect(url)
      : new SyntheticClient(this.options.network ?? "synthetic-1", this.options.latestHeight ?? 100);
    this.clients.push(client);
    return client;
  }

  disconnect(client: SyntheticClient): void {
    client.disconnected = true;
    client.closeSubscriptions();
  }

  async status(client: SyntheticClient) {
    if (client.statusOverride) {
      return client.statusOverride();
    }
    return {
      network: client.network,
      latestHeight: client.latestHeight,
    };
  }

  async fetchBlock(client: SyntheticClient, height: number, _ctx: FetchContext): Promise<FetchedBlock<SyntheticBlock>> {
    client.fetched.push(height);
    return {
      height,
      // One second per block, starting at the Unix epoch, so timestamps are deterministic
      timestamp: new Date(height * 1000).toISOString(),
      data: {
        height,
        txs: this.options.txsPerBlock ?? 0,
      },
    };
  }

  async processBlock(block: FetchedBlock<SyntheticBlock>, ctx: ProcessContext): Promise<void> {
    if (this.options.onProcess) {
      await this.options.onProcess(block, ctx);
    }
    ctx.prometheus?.recordTransactions(block.data.txs);
  }

  async abciQuery(client: SyntheticClient, path: string, data: Uint8Array, height?: number): Promise<AbciResult> {
    if (!client.abci) {
      return {
        code: 6,
        log: "unknown request: " + path,
        value: new Uint8Array(),
      };
    }
    return client.abci(path, data, height);
  }

  async genesis(ctx: GenesisContext): Promise<void> {
    if (this.options.onGenesis) {
      await this.options.onGenesis(ctx);
    }
  }
}

/** Builds a synthetic chain adapter */
export function syntheticChain(options: SyntheticChainOptions = {
}): SyntheticChain {
  return new SyntheticChain(options);
}
