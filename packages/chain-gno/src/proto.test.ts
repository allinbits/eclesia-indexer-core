import {
  describe, expect, it,
} from "vitest";

import {
  readFields, stringField, stringFields, varintField,
} from "./proto.js";

/** /vm.m_enable_pkg as stored from gnoland-1 tx 1AFC2AC8...: approver, pkg_path, pkg_hash, a varint */
const enablePkg = Buffer.from("CihnMXlhYWE2cmNwNGV3NXlqemRqNHltczU5Nnd4MmR0cmozYTg2NzA0Eitnbm8ubGFuZC9yL21vdWwveC9kYWlseS9jbGlmZnZlc3RpbmdkZW1vL3YwGkBlNDhkMWNmNjU4Yzg4MjgyNDc2ZDgyYTFlYmIxYjAxMGM1YTBiMGM4YzY3MDc4OTU0YTZmZDdjNGU4NmJmY2YyIJyWAw==", "base64");

describe("proto reader", () => {
  it("splits a mainnet message into its fields", () => {
    const fields = readFields(enablePkg);
    expect(fields.map(f => [f.number, f.wireType])).toEqual([[1, 2], [2, 2], [3, 2], [4, 0]]);
    expect(stringField(fields, 1)).toBe("g1yaaa6rcp4ew5yjzdj4yms596wx2dtrj3a86704");
    expect(stringField(fields, 2)).toBe("gno.land/r/moul/x/daily/cliffvestingdemo/v0");
    expect(stringField(fields, 3)).toBe("e48d1cf658c88282476d82a1ebb1b010c5a0b0c8c67078954a6fd7c4e86bfcf2");
    expect(varintField(fields, 4)).toBe(51996n);
    expect(stringField(fields, 9)).toBe("");
    expect(varintField(fields, 9)).toBe(0n);
  });

  it("reads repeated strings and rejects truncated input", () => {
    const fields = readFields(new Uint8Array([0x0a, 0x01, 0x61, 0x0a, 0x01, 0x62, 0x10, 0x05]));
    expect(stringFields(fields, 1)).toEqual(["a", "b"]);
    expect(varintField(fields, 2)).toBe(5n);
    expect(() => readFields(new Uint8Array([0x0a, 0x05, 0x61]))).toThrow("Truncated");
  });
});
