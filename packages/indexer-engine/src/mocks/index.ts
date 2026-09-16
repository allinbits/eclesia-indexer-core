/**
 * Mock implementations for testing and benchmarking the engine without a network, plus the
 * adapter contract checks every chain package runs. Chain-specific mocks (a synthetic CometBFT
 * or Tendermint2 node) live in the chain adapter packages.
 */
export * from "./adapter-contract.js";
export * from "./synthetic-chain.js";
