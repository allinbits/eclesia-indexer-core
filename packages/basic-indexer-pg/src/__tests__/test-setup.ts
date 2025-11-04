import type {
  Mock,
} from "vitest";

import {
  PgIndexerConfig,
} from "../index";

/**
 * Shared test setup for PgIndexer tests
 * Provides utilities used across all test files
 */

// Define mock client type
export interface MockClient {
  connect: Mock
  query: Mock
  end: Mock
  on: Mock
}

/**
 * Creates a default test configuration
 */
export function createTestConfig(): PgIndexerConfig {
  return {
    startHeight: 1,
    batchSize: 100,
    modules: [],
    rpcUrl: "http://localhost:26657",
    logLevel: "info",
    usePolling: false,
    pollingInterval: 1000,
    minimal: false,
    dbConnectionString: "postgresql://user:pass@localhost:5432/testdb",
  };
}
