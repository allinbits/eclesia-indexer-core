import {
  expect, test,
} from "vitest";

import {
  decodeAttr,
} from "./text";

/**
 * Test suite for text decoding utilities
 * Verifies proper handling of string and Uint8Array inputs
 */

/** Test decoding of plain string input (passthrough) */
test("Decode actual string",
  () => {
    expect(decodeAttr("Hello world")).toBe("Hello world");
  });

/** Test decoding of Uint8Array to UTF-8 string */
test("Decode bytearray",
  () => {
    // UTF-8 bytes for "Hello world"
    expect(decodeAttr(new Uint8Array([72, 101, 108, 108, 111, 32, 119, 111, 114, 108, 100]))).toBe("Hello world");
  });
