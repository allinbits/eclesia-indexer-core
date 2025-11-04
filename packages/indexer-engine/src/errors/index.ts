/**
 * Custom error classes for the Eclesia indexer
 * These provide better context and error tracking throughout the application
 */

/**
 * Base error class for all indexer errors
 * Extends Error with additional context fields
 */
export class IndexerError extends Error {
  /** Error code for programmatic error handling */
  public readonly code: string;

  /** Additional context data for debugging */
  public readonly context?: Record<string, unknown>;

  constructor(message: string, code: string = "INDEXER_ERROR", context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Configuration-related errors
 * Thrown when indexer configuration is invalid or missing
 */
export class ConfigurationError extends IndexerError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "CONFIGURATION_ERROR", context);
  }
}

/**
 * RPC connection and communication errors
 * Thrown when RPC calls fail or connections are lost
 */
export class RPCError extends IndexerError {
  /** The RPC endpoint that failed */
  public readonly endpoint?: string;

  /** The height being queried when error occurred */
  public readonly height?: number;

  constructor(
    message: string,
    endpoint?: string,
    height?: number,
    context?: Record<string, unknown>,
  ) {
    super(message, "RPC_ERROR", {
      ...context,
      endpoint,
      height,
    });
    this.endpoint = endpoint;
    this.height = height;
  }
}

/**
 * Database operation errors
 * Thrown when database queries or transactions fail
 */
export class DatabaseError extends IndexerError {
  /** The SQL query that failed */
  public readonly query?: string;

  /** The operation that failed (e.g., "BEGIN", "COMMIT", "ROLLBACK") */
  public readonly operation?: string;

  constructor(message: string, operation?: string, query?: string, context?: Record<string, unknown>) {
    super(message, "DATABASE_ERROR", {
      ...context,
      operation,
      query,
    });
    this.operation = operation;
    this.query = query;
  }
}

/**
 * Block processing errors
 * Thrown when block data is invalid or processing fails
 */
export class BlockProcessingError extends IndexerError {
  /** The height of the block that failed to process */
  public readonly height: number;

  constructor(message: string, height: number, context?: Record<string, unknown>) {
    super(message, "BLOCK_PROCESSING_ERROR", {
      ...context,
      height,
    });
    this.height = height;
  }
}

/**
 * Module initialization errors
 * Thrown when indexing modules fail to initialize
 */
export class ModuleError extends IndexerError {
  /** The name of the module that failed */
  public readonly moduleName: string;

  constructor(message: string, moduleName: string, context?: Record<string, unknown>) {
    super(message, "MODULE_ERROR", {
      ...context,
      moduleName,
    });
    this.moduleName = moduleName;
  }
}

/**
 * Genesis processing errors
 * Thrown when genesis file parsing or processing fails
 */
export class GenesisError extends IndexerError {
  /** Path to the genesis file */
  public readonly genesisPath?: string;

  constructor(message: string, genesisPath?: string, context?: Record<string, unknown>) {
    super(message, "GENESIS_ERROR", {
      ...context,
      genesisPath,
    });
    this.genesisPath = genesisPath;
  }
}
