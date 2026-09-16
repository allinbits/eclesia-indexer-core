import {
  describe, expect, it,
} from "vitest";

import {
  messageDecoders, MSG_ENABLE_PACKAGE, MSG_REJECT_PACKAGE, MsgEnablePackage, MsgRejectPackage,
} from "./messages.js";

/** Encodes flat string / varint fields the way amino binary does, for messages without an encoder */
const encode = (fields: Array<[number, string | bigint]>): Uint8Array => {
  const out: number[] = [];
  const varint = (n: bigint) => {
    for (;;) {
      const byte = Number(n & 0x7fn);
      n >>= 7n;
      if (n === 0n) {
        out.push(byte);
        return;
      }
      out.push(byte | 0x80);
    }
  };
  for (const [number, value] of fields) {
    if (typeof value === "string") {
      const bytes = Buffer.from(value);
      varint(BigInt((number << 3) | 2));
      varint(BigInt(bytes.length));
      out.push(...bytes);
    }
    else {
      varint(BigInt(number << 3));
      varint(value);
    }
  }
  return new Uint8Array(out);
};

describe("approval message decoders", () => {
  it("decodes /vm.m_enable_pkg as stored from gnoland-1", () => {
    const bytes = Buffer.from("CihnMXlhYWE2cmNwNGV3NXlqemRqNHltczU5Nnd4MmR0cmozYTg2NzA0Eitnbm8ubGFuZC9yL21vdWwveC9kYWlseS9jbGlmZnZlc3RpbmdkZW1vL3YwGkBlNDhkMWNmNjU4Yzg4MjgyNDc2ZDgyYTFlYmIxYjAxMGM1YTBiMGM4YzY3MDc4OTU0YTZmZDdjNGU4NmJmY2YyIJyWAw==", "base64");
    const msg = messageDecoders[MSG_ENABLE_PACKAGE].decode(bytes) as MsgEnablePackage;
    expect(msg).toEqual({
      approver: "g1yaaa6rcp4ew5yjzdj4yms596wx2dtrj3a86704",
      pkgPath: "gno.land/r/moul/x/daily/cliffvestingdemo/v0",
      pkgHash: "e48d1cf658c88282476d82a1ebb1b010c5a0b0c8c67078954a6fd7c4e86bfcf2",
      pkgHeight: 51996n,
    });
  });

  it("tolerates an enable without the appended hash and height fields", () => {
    const msg = messageDecoders[MSG_ENABLE_PACKAGE].decode(encode([[1, "g1approver"], [2, "gno.land/r/x"]])) as MsgEnablePackage;
    expect(msg).toEqual({
      approver: "g1approver",
      pkgPath: "gno.land/r/x",
      pkgHash: "",
      pkgHeight: 0n,
    });
  });

  it("decodes /vm.m_reject_pkg", () => {
    const msg = messageDecoders[MSG_REJECT_PACKAGE].decode(encode([[1, "g1sender"], [2, "gno.land/r/parked"]])) as MsgRejectPackage;
    expect(msg).toEqual({
      sender: "g1sender",
      pkgPath: "gno.land/r/parked",
    });
  });
});
