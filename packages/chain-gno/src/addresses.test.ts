import {
  gno,
} from "@gnolang/gno-types";
import {
  describe, expect, it,
} from "vitest";

import {
  PUBKEY_ED25519, PUBKEY_SECP256K1, pubKeyAddress, sessionAddressOf, ZERO_ADDRESS,
} from "./addresses.js";

describe("pubKeyAddress", () => {
  it("derives the gno.land test1 address from its secp256k1 key", () => {
    // gnokey: test1 -> g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5, pub gpub1pgfj7ard9eg82cjtv4u4xetrwqer2dntxyfzxz3pq0skzdkmzu0r9h6gny6eg8c9dc303xrrudee6z4he4y7cs5rnjwmyf40yaj
    const key = Buffer.from("03e16136db171e32df489935941f056e22f89863e3739d0ab7cd49ec42839c9db2", "hex"); // 33-byte compressed key, from the gpub1... bech32 form
    const value = gno.tm2.tx.tx.PubKeySecp256k1.encode({
      key,
    }).finish();
    expect(pubKeyAddress({
      typeUrl: PUBKEY_SECP256K1,
      value,
    })).toBe("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5");
  });

  it("derives ed25519 addresses from the truncated sha256", () => {
    const value = gno.tm2.tx.tx.PubKeySecp256k1.encode({
      key: new Uint8Array(32).fill(7),
    }).finish();
    const address = pubKeyAddress({
      typeUrl: PUBKEY_ED25519,
      value,
    });
    expect(address).toMatch(/^g1[a-z0-9]{38}$/);
  });

  it("returns null for absent or unsupported keys", () => {
    expect(pubKeyAddress(undefined)).toBeNull();
    expect(pubKeyAddress({
      typeUrl: "/tm.PubKeyMultisig",
      value: new Uint8Array([1]),
    })).toBeNull();
  });
});

describe("sessionAddressOf", () => {
  it("treats the zero address and empty values as a master-key signature", () => {
    expect(sessionAddressOf(ZERO_ADDRESS)).toBeNull();
    expect(sessionAddressOf("")).toBeNull();
    expect(sessionAddressOf(undefined)).toBeNull();
    expect(sessionAddressOf("g1session")).toBe("g1session");
  });
});
