/**
 * Mock implementations for testing and benchmarking
 * Provides RPC client and database mocks to isolate engine performance
 */

export {
  createMockRpcClient, mockModuleAccounts, MockRpcClient, type MockRpcConfig, syntheticAddress,
} from "./rpc-client.js";
