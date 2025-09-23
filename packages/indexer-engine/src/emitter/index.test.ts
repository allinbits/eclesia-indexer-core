import {
  expect, test,
} from "vitest";

import {
  EclesiaEmitter,
} from "./";

/**
 * Test suite for EclesiaEmitter event handling functionality
 * Verifies proper event registration, handler counting, and unhandled event routing
 */
test(
  "Handling of emit types", () => {
    // Create emitter with typed event map
    const emitter = new EclesiaEmitter<{
      test: string
      test2: number
    }>();

    // Register first handler for 'test' event
    emitter.on(
      "test", (_arg) => {
        // Empty handler for testing
      },
    );
    expect(emitter.handled.get("test")).toBe(1);

    // Register second handler for 'test' event
    emitter.on(
      "test", (_arg) => {
        // Empty handler for testing
      },
    );
    expect(emitter.handled.get("test")).toBe(2);

    // Register handler for 'test2' event
    emitter.on(
      "test2", (_arg) => {
        // Empty handler for testing
      },
    );
    expect(emitter.handled.get("test2")).toBe(1);

    // Remove one 'test' handler
    emitter.off(
      "test", (_arg) => {
        // Empty handler for testing
      },
    );
    expect(emitter.handled.get("test")).toBe(1);

    // Remove last 'test' handler
    emitter.off(
      "test", (_arg) => {
        // Empty handler for testing
      },
    );
    expect(emitter.handled.get("test")).toBeFalsy();

    // Test unhandled event routing
    emitter.on(
      "_unhandled", (arg) => {
        expect(arg.type).toBe("test");
        expect(arg.event).toBe("Hello world");
      },
    );

    // Emit to unhandled event (no handlers registered for 'test')
    emitter.emit(
      "test", "Hello world",
    );
  },
);
