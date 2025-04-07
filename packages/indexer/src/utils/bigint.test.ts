import { expect, test } from "vitest";
import { toPlainObject } from "./bigint";

test("JSON handling of bigints", () => {
  expect(toPlainObject({ abigint: 123n })).toStrictEqual({ abigint: "123" });
  expect(toPlainObject({ abigint: BigInt(123) })).toStrictEqual({ abigint: "123" });
  expect(toPlainObject({ abigint: BigInt(123),
    astring: "123" })).toStrictEqual({ abigint: "123",
    astring: "123" });
  expect(toPlainObject({ abigint: BigInt(123),
    astring: "123",
    anumber: 123 })).toStrictEqual({ abigint: "123",
    astring: "123",
    anumber: 123 });
  expect(toPlainObject({ abigint: BigInt(123),
    astring: "123",
    anumber: 123,
    anull: null })).toStrictEqual({ abigint: "123",
    astring: "123",
    anumber: 123,
    anull: null });
});