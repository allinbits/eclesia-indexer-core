import {
  QueryValidatorsRequest, QueryValidatorsResponse,
} from "cosmjs-types/cosmos/staking/v1beta1/query.js";
import {
  describe, expect, it,
} from "vitest";

import {
  hasBlockEventMode,
} from "../utils/text.js";
import {
  MockRpcClient,
} from "./rpc-client.js";

const config = {
  chainId: "mock-1",
  txPerBlock: 2,
  startHeight: 1,
  endHeight: 10,
};

describe("MockRpcClient", () => {
  it("produces CometBFT 0.37 results with a structured log", async () => {
    const results = await new MockRpcClient(config).blockResults(3);
    expect("beginBlockEvents" in results).toBe(true);
    expect(JSON.parse(results.results[0].log ?? "[]")[0].msg_index).toBe(0);
  });

  it("produces CometBFT 0.38 results tagged with the SDK's mode values", async () => {
    const results = await new MockRpcClient({
      ...config,
      cometVersion: "0.38",
    }).blockResults(3);
    const events = (results as unknown as {
      finalizeBlockEvents: Parameters<typeof hasBlockEventMode>[0][]
    }).finalizeBlockEvents;
    expect(events.filter(e => hasBlockEventMode(e, "BeginBlock")).length).toBe(1);
    expect(events.filter(e => hasBlockEventMode(e, "EndBlock")).length).toBe(1);
    expect(results.results[0].log).toBe("");
    expect(results.results[0].events.some(e => e.attributes.some(a => a.key === "msg_index"))).toBe(true);
  });

  it("paginates the validator set and rejects unknown ABCI paths with a code", async () => {
    const mock = new MockRpcClient({
      ...config,
      validatorCount: 5,
    });
    const request = (key?: Uint8Array) => QueryValidatorsRequest.encode(QueryValidatorsRequest.fromPartial({
      pagination: key
        ? {
          limit: 2n,
          key,
        }
        : {
          limit: 2n,
        },
    })).finish();
    const first = QueryValidatorsResponse.decode((await mock.abciQuery({
      path: "/cosmos.staking.v1beta1.Query/Validators",
      data: request(),
    })).value);
    expect(first.validators.length).toBe(2);
    expect(first.pagination?.nextKey.length).toBeGreaterThan(0);
    const last = QueryValidatorsResponse.decode((await mock.abciQuery({
      path: "/cosmos.staking.v1beta1.Query/Validators",
      data: request(new Uint8Array([4])),
    })).value);
    expect(last.validators.length).toBe(1);
    expect(last.pagination?.nextKey.length).toBe(0);

    const unknown = await mock.abciQuery({
      path: "/nope.v1.Query/Nothing",
      data: new Uint8Array(),
    });
    expect(unknown.code).toBe(6);
  });
});
