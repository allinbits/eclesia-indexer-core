/**
 * Mock implementations for testing and benchmarking
 * Provides RPC client and database mocks to isolate engine performance
 */

export {
  createMockRpcClient, MockRpcClient, type MockRpcConfig,
} from "./rpc-client.js";
