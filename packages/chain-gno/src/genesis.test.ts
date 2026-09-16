import {
  describe, expect, it,
} from "vitest";

import {
  parseGenesisBalance,
} from "./genesis.js";

describe("parseGenesisBalance", () => {
  it("parses the amino string form", () => {
    expect(parseGenesisBalance("g1abc=10000000ugnot")).toEqual({
      address: "g1abc",
      amount: "10000000ugnot",
      vesting: null,
    });
  });

  it("parses vesting suffixes", () => {
    expect(parseGenesisBalance(" g1abc=100ugnot,5atom;vesting=100ugnot,1700000000,1800000000;type=delayed ")).toEqual({
      address: "g1abc",
      amount: "100ugnot,5atom",
      vesting: {
        originalVesting: "100ugnot",
        startTime: 1700000000,
        endTime: 1800000000,
        delayed: true,
      },
    });
  });

  it("accepts the object form", () => {
    expect(parseGenesisBalance({
      address: "g1abc",
      amount: "1ugnot",
      vesting: {
        original_vesting: "1ugnot",
        start_time: "1",
        end_time: 2,
      },
    })).toEqual({
      address: "g1abc",
      amount: "1ugnot",
      vesting: {
        originalVesting: "1ugnot",
        startTime: 1,
        endTime: 2,
        delayed: false,
      },
    });
  });

  it("rejects malformed entries", () => {
    expect(() => parseGenesisBalance("g1abc")).toThrow("Malformed");
    expect(() => parseGenesisBalance({
    } as never)).toThrow("Malformed");
  });
});
