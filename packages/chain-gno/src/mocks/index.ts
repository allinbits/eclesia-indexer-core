/**
 * A synthetic Tendermint2 node for tests and benchmarks. Plug it into the adapter with
 * `gno({ connect: async () => Mocks.createMockTm2Client({...}) })`.
 */
export * from "./tm2-node.js";
