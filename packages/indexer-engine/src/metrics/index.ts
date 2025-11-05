/**
 * Prometheus metrics for monitoring indexer performance and health
 * Exposes metrics for blocks indexed, queue depth, errors, and processing times
 */

import {
  collectDefaultMetrics, Counter, Gauge, Histogram, Registry,
} from "prom-client";

/** Prometheus metrics registry */
export class IndexerMetrics {
  /** Prometheus registry instance */
  public readonly registry: Registry;

  /** Counter for total blocks indexed */
  public readonly blocksIndexed: Counter;

  /** Gauge for current block height */
  public readonly currentHeight: Gauge;

  /** Gauge for latest chain block height */
  public readonly latestHeight: Gauge;

  /** Gauge for blocks behind chain tip */
  public readonly blocksBehind: Gauge;

  /** Gauge for block queue depth */
  public readonly queueDepth: Gauge;

  /** Counter for total errors */
  public readonly errors: Counter;

  /** Counter for RPC errors */
  public readonly rpcErrors: Counter;

  /** Counter for database errors */
  public readonly databaseErrors: Counter;

  /** Histogram for block processing duration */
  public readonly blockProcessingDuration: Histogram;

  /** Histogram for RPC call duration */
  public readonly rpcCallDuration: Histogram;

  /** Histogram for database query duration */
  public readonly databaseQueryDuration: Histogram;

  /** Gauge for retry count */
  public readonly retryCount: Gauge;

  /** Counter for total transactions processed */
  public readonly transactionsProcessed: Counter;

  constructor() {
    this.registry = new Registry();

    // Collect default Node.js metrics (memory, CPU, etc.)
    collectDefaultMetrics({
      register: this.registry,
    });

    // Block indexing metrics
    this.blocksIndexed = new Counter({
      name: "indexer_blocks_indexed_total",
      help: "Total number of blocks indexed",
      registers: [this.registry],
    });

    this.currentHeight = new Gauge({
      name: "indexer_current_height",
      help: "Current block height being processed",
      registers: [this.registry],
    });

    this.latestHeight = new Gauge({
      name: "indexer_latest_chain_height",
      help: "Latest block height on the chain",
      registers: [this.registry],
    });

    this.blocksBehind = new Gauge({
      name: "indexer_blocks_behind",
      help: "Number of blocks behind chain tip",
      registers: [this.registry],
    });

    this.queueDepth = new Gauge({
      name: "indexer_queue_depth",
      help: "Current depth of block processing queue",
      registers: [this.registry],
    });

    // Error metrics
    this.errors = new Counter({
      name: "indexer_errors_total",
      help: "Total number of indexer errors",
      labelNames: ["type"],
      registers: [this.registry],
    });

    this.rpcErrors = new Counter({
      name: "indexer_rpc_errors_total",
      help: "Total number of RPC errors",
      registers: [this.registry],
    });

    this.databaseErrors = new Counter({
      name: "indexer_database_errors_total",
      help: "Total number of database errors",
      registers: [this.registry],
    });

    // Performance metrics
    this.blockProcessingDuration = new Histogram({
      name: "indexer_block_processing_duration_seconds",
      help: "Time spent processing a single block",
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.rpcCallDuration = new Histogram({
      name: "indexer_rpc_call_duration_seconds",
      help: "Duration of RPC calls",
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
      labelNames: ["method"],
      registers: [this.registry],
    });

    this.databaseQueryDuration = new Histogram({
      name: "indexer_database_query_duration_seconds",
      help: "Duration of database queries",
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
      labelNames: ["query_type"],
      registers: [this.registry],
    });

    // Operational metrics
    this.retryCount = new Gauge({
      name: "indexer_retry_count",
      help: "Current number of retry attempts",
      registers: [this.registry],
    });

    this.transactionsProcessed = new Counter({
      name: "indexer_transactions_processed_total",
      help: "Total number of transactions processed",
      registers: [this.registry],
    });
  }

  /**
   * Updates block indexing metrics
   * @param currentHeight - Current height being processed
   * @param latestHeight - Latest height on chain
   * @param queueSize - Current queue depth
   */
  updateBlockMetrics(currentHeight: number, latestHeight: number, queueSize: number) {
    this.blocksIndexed.inc();
    this.currentHeight.set(currentHeight);
    this.latestHeight.set(latestHeight);
    this.blocksBehind.set(latestHeight - currentHeight);
    this.queueDepth.set(queueSize);
  }

  /**
   * Records an error occurrence
   * @param type - Error type (rpc, database, processing, etc.)
   */
  recordError(type: string) {
    this.errors.inc({
      type,
    });

    if (type === "rpc") {
      this.rpcErrors.inc();
    }
    else if (type === "database") {
      this.databaseErrors.inc();
    }
  }

  /**
   * Records block processing duration
   * @param durationSeconds - Duration in seconds
   */
  recordBlockProcessing(durationSeconds: number) {
    this.blockProcessingDuration.observe(durationSeconds);
  }

  /**
   * Times a block processing operation
   * @returns End timer function to call when operation completes
   */
  timeBlockProcessing() {
    return this.blockProcessingDuration.startTimer();
  }

  /**
   * Records RPC call duration
   * @param method - RPC method name
   * @param durationSeconds - Duration in seconds
   */
  recordRpcCall(method: string, durationSeconds: number) {
    this.rpcCallDuration.observe({
      method,
    }, durationSeconds);
  }

  /**
   * Times an RPC call operation
   * @param method - RPC method name
   * @returns End timer function to call when operation completes
   */
  timeRpcCall(method: string) {
    return this.rpcCallDuration.startTimer({
      method,
    });
  }

  /**
   * Records database query duration
   * @param queryType - Type of query (select, insert, update, delete, etc.)
   * @param durationSeconds - Duration in seconds
   */
  recordDatabaseQuery(queryType: string, durationSeconds: number) {
    this.databaseQueryDuration.observe({
      query_type: queryType,
    }, durationSeconds);
  }

  /**
   * Times a database query operation
   * @param queryType - Type of query (select, insert, update, delete, etc.)
   * @returns End timer function to call when operation completes
   */
  timeDatabaseQuery(queryType: string) {
    return this.databaseQueryDuration.startTimer({
      query_type: queryType,
    });
  }

  /**
   * Updates the retry count gauge
   * @param count - Current retry count
   */
  updateRetryCount(count: number) {
    this.retryCount.set(count);
  }

  /**
   * Increments the retry count gauge by 1
   */
  incrementRetryCount() {
    this.retryCount.inc();
  }

  /**
   * Resets the retry count gauge to 0
   */
  resetRetryCount() {
    this.retryCount.set(0);
  }

  /**
   * Records transactions processed
   * @param count - Number of transactions to record (defaults to 1)
   */
  recordTransactions(count: number = 1) {
    this.transactionsProcessed.inc(count);
  }

  /**
   * Gets metrics in Prometheus format
   * @returns Prometheus metrics string
   */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
