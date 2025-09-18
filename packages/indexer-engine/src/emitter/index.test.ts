import {
  expect, test,
} from "vitest";

import {
  EclesiaEmitter,
} from "./";

test(
  "Handling of emit types", () => {
    const emitter = new EclesiaEmitter<{
      test: string
      test2: number
    }>();

    emitter.on(
      "test", (_arg) => {

      },
    );
    expect(emitter.handled.get("test")).toBe(1);

    emitter.on(
      "test", (_arg) => {

      },
    );
    expect(emitter.handled.get("test")).toBe(2);

    emitter.on(
      "test2", (_arg) => {

      },
    );
    expect(emitter.handled.get("test2")).toBe(1);

    emitter.off(
      "test", (_arg) => {

      },
    );
    expect(emitter.handled.get("test")).toBe(1);

    emitter.off(
      "test", (_arg) => {

      },
    );
    expect(emitter.handled.get("test")).toBeFalsy();
    emitter.on(
      "_unhandled", (arg) => {
        expect(arg.type).toBe("test");
        expect(arg.event).toBe("Hello world");
      },
    );
    emitter.emit(
      "test", "Hello world",
    );
  },
);
