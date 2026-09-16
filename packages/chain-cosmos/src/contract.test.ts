import {
  CometClient,
} from "@cosmjs/tendermint-rpc";
import {
  Mocks,
} from "@eclesia/indexer-engine";
import {
  describe, it,
} from "vitest";

import {
  cosmos,
} from "./adapter.js";
import {
  createMockRpcClient,
} from "./mocks/rpc-client.js";

/** The engine's adapter contract, run against the Cosmos adapter on the mock CometBFT node */
describe("Cosmos adapter contract", () => {
  const node = (): CometClient => createMockRpcClient({
    chainId: "contract-1",
    txPerBlock: 2,
    startHeight: 1,
    endHeight: 6,
  });
  it.each(Mocks.adapterContractCases(cosmos({
    connect: async () => node(),
  }), {
    url: "http://mock:26657",
    heights: [1, 6],
    network: "contract-1",
  }))("$name", ({
    run,
  }) => run());
});
