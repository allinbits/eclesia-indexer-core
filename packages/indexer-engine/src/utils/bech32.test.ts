import { expect, test } from "vitest";

import { chainAddressfromKeyhash, keyHashfromAddress, toHexString } from "./bech32";


test("Bech32 functions", ()=> {
  expect(keyHashfromAddress("cosmos1995thtfe5gs47wrrjg9gsq0xs0udq3lrlasttl")).toBe("2968bbad39a2215f3863920a8801e683f8d047e3");
  expect(chainAddressfromKeyhash("cosmos", "2968bbad39a2215f3863920a8801e683f8d047e3")).toBe("cosmos1995thtfe5gs47wrrjg9gsq0xs0udq3lrlasttl");
  expect(chainAddressfromKeyhash("cosmos", "")).toBe("");
  expect(toHexString([10, 1, 2, 3, 4, 5, 6, 7, 8, 255])).toBe("0a0102030405060708ff");
});