/**
 * A synthetic CometBFT node for tests and benchmarks. Plug it into the adapter with
 * `cosmos({ connect: async () => Mocks.createMockRpcClient({...}) })`.
 */
export * from "./rpc-client.js";
