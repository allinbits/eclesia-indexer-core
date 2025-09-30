import {
  expect, test,
} from "vitest";

import {
  toPlainObject,
} from "./bigint";

/**
 * Test suite for BigInt serialization utilities
 * Verifies proper conversion of BigInt values to strings in JSON-safe objects
 */
test(
  "JSON handling of bigints", () => {
    // Test BigInt literal conversion
    expect(toPlainObject({
      abigint: 123n,
    })).toStrictEqual({
      abigint: "123",
    });

    // Test BigInt constructor conversion
    expect(toPlainObject({
      abigint: BigInt(123),
    })).toStrictEqual({
      abigint: "123",
    });

    // Test mixed types with BigInt and string
    expect(toPlainObject({
      abigint: BigInt(123),
      astring: "123",
    })).toStrictEqual({
      abigint: "123",
      astring: "123",
    });

    // Test mixed types with BigInt, string, and number
    expect(toPlainObject({
      abigint: BigInt(123),
      astring: "123",
      anumber: 123,
    })).toStrictEqual({
      abigint: "123",
      astring: "123",
      anumber: 123,
    });

    // Test comprehensive mixed types including null values
    expect(toPlainObject({
      abigint: BigInt(123),
      astring: "123",
      anumber: 123,
      anull: null,
    })).toStrictEqual({
      abigint: "123",
      astring: "123",
      anumber: 123,
      anull: null,
    });
  },
);
