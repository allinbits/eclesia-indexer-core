import {
  expect, test,
} from "vitest";

import {
  decodeAttr, hasBlockEventMode, redactUrl,
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

/**
 * Test suite for finalize_block event mode detection (CometBFT 0.38 / SDK 0.50+)
 */

const attr = (key: string, value: string) => ({
  key,
  value,
});
const bytes = (s: string) => new Uint8Array(Buffer.from(s));

/** The SDK's actual spelling (baseapp.go) must match */
test("hasBlockEventMode matches the SDK's PascalCase mode values",
  () => {
    const begin = {
      attributes: [attr("amount", "1uatom"), attr("mode", "BeginBlock")],
    };
    const end = {
      attributes: [attr("mode", "EndBlock")],
    };
    expect(hasBlockEventMode(begin, "BeginBlock")).toBe(true);
    expect(hasBlockEventMode(begin, "EndBlock")).toBe(false);
    expect(hasBlockEventMode(end, "EndBlock")).toBe(true);
    expect(hasBlockEventMode(end, "BeginBlock")).toBe(false);
  });

/** Snake_case spellings stay accepted for forks that lowercase the value */
test("hasBlockEventMode accepts snake_case mode values",
  () => {
    expect(hasBlockEventMode({
      attributes: [attr("mode", "begin_block")],
    }, "BeginBlock")).toBe(true);
    expect(hasBlockEventMode({
      attributes: [attr("mode", "end_block")],
    }, "EndBlock")).toBe(true);
  });

/** Events without a mode attribute, or with another key, never match */
test("hasBlockEventMode ignores events without a mode attribute",
  () => {
    expect(hasBlockEventMode({
      attributes: [attr("action", "BeginBlock")],
    }, "BeginBlock")).toBe(false);
    expect(hasBlockEventMode({
      attributes: [],
    }, "EndBlock")).toBe(false);
  });

/** CometBFT 0.37-style byte attributes are decoded before comparison */
test("hasBlockEventMode decodes Uint8Array keys and values",
  () => {
    expect(hasBlockEventMode({
      attributes: [
        {
          key: bytes("mode"),
          value: bytes("BeginBlock"),
        },
      ],
    }, "BeginBlock")).toBe(true);
  });

/** Credentials in RPC URLs must never reach the logs */
test("redactUrl masks the password and leaves everything else",
  () => {
    expect(redactUrl("https://user:secret@rpc.example.com:443/path?x=1")).toBe("https://user:***@rpc.example.com/path?x=1");
    expect(redactUrl("wss://rpc.example.com/websocket")).toBe("wss://rpc.example.com/websocket");
    expect(redactUrl("not a url")).toBe("not a url");
  });
