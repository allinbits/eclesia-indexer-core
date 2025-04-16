import { expect, test } from "vitest";

import { decodeAttr } from "./text";

test("Decode actual string", () => {
  expect(decodeAttr("Hello world")).toBe("Hello world");
});

test("Decode bytearray", () => {
  expect(decodeAttr(new Uint8Array([72, 101, 108, 108, 111, 32, 119, 111, 114, 108, 100]))).toBe("Hello world");
});