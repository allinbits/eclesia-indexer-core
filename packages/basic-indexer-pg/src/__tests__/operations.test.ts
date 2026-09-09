import type {
  MockedFunction,
} from "vitest";
import {
  beforeEach, describe, expect, it, vi,
} from "vitest";

import {
  PgIndexer,
} from "../index";
import {
  createMockModule,
  createTestConfig, MockClient,
} from "./test-setup";

/**
 * Tests for PgIndexer runtime operations
 * Covers getInstance, setup, run, and error recovery
 */

// Create shared mock client instance
const mockClient: MockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  query: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
};

// Mock the pg Client
vi.mock("pg", () => ({
  Client: vi.fn(function () { return mockClient; }),
}));

// Mock the EclesiaIndexer
vi.mock("@eclesia/indexer-engine", async () => {
  const actual = await vi.importActual<typeof import("@eclesia/indexer-engine")>("@eclesia/indexer-engine");
  return {
    ...actual,
    EclesiaIndexer: vi.fn().mockImplementation(function () {
      return {
        log: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          verbose: vi.fn(),
          debug: vi.fn(),
          silly: vi.fn(),
        },
        connect: vi.fn().mockResolvedValue(true),
        start: vi.fn().mockResolvedValue(undefined),
        whenStopped: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };
    }),
  };
});

describe("PgIndexer Runtime Operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.connect.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValue({
      rows: [],
      rowCount: 0,
    });
    mockClient.end.mockResolvedValue(undefined);
  });

  describe("getInstance", () => {
    it("should return database client for non-silly log level", () => {
      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      const instance = indexer.getInstance();

      expect(instance).toBeDefined();
    });

    it("should return wrapped client with query timing for silly log level", () => {
      const config = createTestConfig();
      const sillyConfig = {
        ...config,
        logLevel: "silly" as const,
      };
      const indexer = new PgIndexer(sillyConfig);
      const instance = indexer.getInstance();

      expect(instance).toBeDefined();
      expect(instance.query).toBeDefined();
    });

    it("should log query performance in silly mode", async () => {
      mockClient.query.mockResolvedValue({
        rows: [],
        rowCount: 0,
      });

      const config = createTestConfig();
      const sillyConfig = {
        ...config,
        logLevel: "silly" as const,
      };
      const indexer = new PgIndexer(sillyConfig);
      const instance = indexer.getInstance();

      await instance.query("SELECT 1");

      expect(indexer.indexer.log.silly).toHaveBeenCalled();
    });
  });

  describe("Setup and Run", () => {
    it("should connect to RPC during setup", async () => {
      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      await indexer.setup();

      expect(indexer.indexer.connect).toHaveBeenCalled();
    });

    it("should throw error if RPC connection fails during setup", async () => {
      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      indexer.indexer.connect = vi.fn().mockResolvedValue(false) as MockedFunction<() => Promise<boolean>>;

      await expect(indexer.setup()).rejects.toThrow("Could not connect to RPC");
    });

    it("should call setup on all modules", async () => {
      const config = createTestConfig();
      const mockModule1 = createMockModule("module-1");
      const mockModule2 = createMockModule("module-2");

      const indexer = new PgIndexer(config, [mockModule1, mockModule2]);
      await indexer.setup();

      expect(mockModule1.setup).toHaveBeenCalled();
      expect(mockModule2.setup).toHaveBeenCalled();
    });

    it("should start the engine during run", async () => {
      const config = createTestConfig();
      const indexer = new PgIndexer(config);

      await indexer.run();

      expect(indexer.indexer.start).toHaveBeenCalled();
    });
  });

  describe("Error Recovery", () => {
    it("should handle database disconnection", () => {
      const config = createTestConfig();
      const indexer = new PgIndexer(config);

      const endCallback = mockClient.on.mock.calls.find(
        (call: unknown[]) => call[0] === "end",
      )?.[1];

      if (endCallback) {
        endCallback();
      }

      expect(indexer.indexer.log.warn).toHaveBeenCalledWith(
        "Database client disconnected",
      );
    });

    it("should handle database errors", () => {
      const config = createTestConfig();
      const indexer = new PgIndexer(config);

      const errorCallback = mockClient.on.mock.calls.find(
        (call: unknown[]) => call[0] === "error",
      )?.[1];

      const testError = new Error("Database error");
      if (errorCallback) {
        errorCallback(testError);
      }

      expect(indexer.indexer.log.error).toHaveBeenCalledWith("Error in db", {
        error: testError,
      });
    });

    it("should reconnect after disconnection when getNextHeight is called", async () => {
      mockClient.query.mockResolvedValue({
        rowCount: 0,
        rows: [],
      });

      const config = createTestConfig();
      const indexer = new PgIndexer(config);

      await indexer.getNextHeight();
      expect(mockClient.connect).toHaveBeenCalledTimes(1);

      const endCallback = mockClient.on.mock.calls.find(
        (call: unknown[]) => call[0] === "end",
      )?.[1];

      if (endCallback) {
        endCallback();
      }

      await indexer.getNextHeight();
      expect(mockClient.connect).toHaveBeenCalledTimes(2);
    });
  });

  describe("fatal-error", () => {
    it("stops and exits the process by default", async () => {
      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      const handler = (indexer.indexer.on as unknown as ReturnType<typeof vi.fn>).mock.calls.find((call: unknown[]) => call[0] === "fatal-error")?.[1];
      expect(handler).toBeDefined();
      const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      const stop = vi.spyOn(indexer, "stop").mockResolvedValue(undefined);

      await handler({
        error: new Error("Block 42 failed 5 times in a row"),
        message: "Block processing is stuck",
        height: 42,
      });

      expect(stop).toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(1);
      exit.mockRestore();
    });

    it("does not exit when exitOnFatal is false", async () => {
      const indexer = new PgIndexer({
        ...createTestConfig(),
        exitOnFatal: false,
      });
      const handler = (indexer.indexer.on as unknown as ReturnType<typeof vi.fn>).mock.calls.find((call: unknown[]) => call[0] === "fatal-error")?.[1];
      const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      vi.spyOn(indexer, "stop").mockResolvedValue(undefined);

      await handler({
        error: new Error("x"),
        message: "y",
      });

      expect(exit).not.toHaveBeenCalled();
      exit.mockRestore();
    });
  });

  describe("silly-mode client", () => {
    it("forwards every client method, not only query", () => {
      const indexer = new PgIndexer({
        ...createTestConfig(),
        logLevel: "silly",
      });
      const client = indexer.getInstance();
      expect(typeof client.query).toBe("function");
      expect(typeof client.connect).toBe("function");
      expect(typeof client.end).toBe("function");
      expect(typeof client.on).toBe("function");
    });
  });
});
