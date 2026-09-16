import {
  describe, it,
} from "vitest";

import {
  adapterContractCases,
} from "./adapter-contract.js";
import {
  syntheticChain,
} from "./synthetic-chain.js";

/**
 * The synthetic chain must itself honour the adapter contract, since every chain package
 * runs these same checks against its own mock node.
 */
describe("synthetic chain adapter contract", () => {
  it.each(adapterContractCases(syntheticChain({
    latestHeight: 5,
    onProcess: async (block, ctx) => {
      await ctx.emit("log", {
        type: "info",
        message: "block " + block.height,
        height: ctx.height,
        timestamp: ctx.timestamp,
      });
    },
  }), {
    url: "http://synthetic",
    heights: [1, 5],
    network: "synthetic-1",
  }))("$name", ({
    run,
  }) => run());
});
