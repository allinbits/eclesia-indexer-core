import {
  expect, test, vi,
} from "vitest";

import {
  EclesiaEmitter,
} from "./";

/**
 * Test suite for EclesiaEmitter event handling functionality
 * Verifies handler counting, removal of exactly what was registered, and unhandled routing
 */
test("handled counts follow on() and off() of the registered handlers", () => {
  const emitter = new EclesiaEmitter();
  const first = () => {};
  const second = () => {};

  emitter.on("log", first);
  expect(emitter.handled.get("log")).toBe(1);
  emitter.on("log", second);
  expect(emitter.handled.get("log")).toBe(2);
  emitter.on("tx_memo", () => {});
  expect(emitter.handled.get("tx_memo")).toBe(1);

  // A function that was never registered must not change the count
  emitter.off("log", () => {});
  expect(emitter.handled.get("log")).toBe(2);

  emitter.off("log", first);
  expect(emitter.handled.get("log")).toBe(1);
  emitter.off("log", second);
  expect(emitter.handled.get("log")).toBeFalsy();
});

test("the same handler registered twice needs two off() calls", () => {
  const emitter = new EclesiaEmitter();
  const handler = vi.fn();

  emitter.on("log", handler);
  emitter.on("log", handler);
  expect(emitter.handled.get("log")).toBe(2);

  emitter.off("log", handler);
  expect(emitter.handled.get("log")).toBe(1);
  emitter.emit("log", {
    type: "info",
    message: "still delivered",
  });
  expect(handler).toHaveBeenCalledTimes(1);

  emitter.off("log", handler);
  expect(emitter.handled.get("log")).toBeFalsy();
});

test("events without handlers are routed to _unhandled", () => {
  const emitter = new EclesiaEmitter();
  const unhandled = vi.fn();
  emitter.on("_unhandled", unhandled);

  emitter.emit("log", {
    type: "info",
    message: "Hello world",
  });

  expect(unhandled).toHaveBeenCalledTimes(1);
  expect(unhandled.mock.calls[0][0].type).toBe("log");
  expect(unhandled.mock.calls[0][0].event).toEqual({
    type: "info",
    message: "Hello world",
  });
});

test("handlersFor returns the raw handlers in registration order and tracks off()", () => {
  const emitter = new EclesiaEmitter();
  const a = () => {};
  const b = () => {};
  emitter.on("log", a);
  emitter.on("log", b);
  emitter.on("log", a);
  expect(emitter.handlersFor("log")).toEqual([a, b, a]);
  emitter.off("log", a);
  expect(emitter.handlersFor("log")).toEqual([a, b]);
  expect(emitter.handlersFor("tx_memo")).toEqual([]);
});
