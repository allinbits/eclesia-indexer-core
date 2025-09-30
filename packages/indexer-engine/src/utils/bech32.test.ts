import {
  expect, test,
} from "vitest";

import {
  chainAddressfromKeyhash, keyHashfromAddress, toHexString,
} from "./bech32";

/**
 * Test suite for bech32 address encoding/decoding utilities
 * Verifies proper conversion between bech32 addresses and hex key hashes
 */
test("Bech32 functions",
  () => {
    // Test decoding a valid cosmos address to hex key hash
    expect(keyHashfromAddress("cosmos1995thtfe5gs47wrrjg9gsq0xs0udq3lrlasttl")).toBe("2968bbad39a2215f3863920a8801e683f8d047e3");

    // Test encoding a hex key hash back to cosmos address
    expect(chainAddressfromKeyhash("cosmos",
      "2968bbad39a2215f3863920a8801e683f8d047e3")).toBe("cosmos1995thtfe5gs47wrrjg9gsq0xs0udq3lrlasttl");

    // Test empty key hash returns empty string
    expect(chainAddressfromKeyhash("cosmos",
      "")).toBe("");

    // Test hex string conversion from byte array
    expect(toHexString([10, 1, 2, 3, 4, 5, 6, 7, 8, 255])).toBe("0a0102030405060708ff");
  });
