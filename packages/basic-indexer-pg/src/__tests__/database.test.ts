import {
  DB_CLIENT_RECYCLE_COUNT,
} from "@eclesia/indexer-engine";
import {
  Client,
} from "pg";
import {
  beforeEach, describe, expect, it, vi,
} from "vitest";

import {
  PgIndexer,
} from "../index";
import {
  createTestConfig, MockClient,
} from "./test-setup";

/**
 * Tests for PgIndexer database operations
 * Covers connections, transactions, height tracking, and client recycling
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
  Client: vi.fn(() => mockClient),
}));

// Mock the EcleciaIndexer
vi.mock("@eclesia/indexer-engine", async () => {
  const actual = await vi.importActual<typeof import("@eclesia/indexer-engine")>("@eclesia/indexer-engine");
  return {
    ...actual,
    EcleciaIndexer: vi.fn().mockImplementation(() => ({
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
    })),
  };
});

describe("PgIndexer Database Operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.connect.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValue({
      rows: [],
      rowCount: 0,
    });
    mockClient.end.mockResolvedValue(undefined);
  });

  describe("Connection Handling", () => {
    it("should connect to database when getNextHeight is called", async () => {
      mockClient.query.mockResolvedValue({
        rowCount: 0,
        rows: [],
      });

      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      await indexer.getNextHeight();

      expect(mockClient.connect).toHaveBeenCalled();
    });

    it("should not reconnect if already connected", async () => {
      mockClient.query.mockResolvedValue({
        rowCount: 0,
        rows: [],
      });

      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      await indexer.getNextHeight();
      await indexer.getNextHeight();

      expect(mockClient.connect).toHaveBeenCalledTimes(1);
    });

    it("should handle connection errors gracefully", async () => {
      const connectionError = new Error("Connection failed");
      mockClient.connect.mockRejectedValue(connectionError);

      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      await expect(indexer.getNextHeight()).rejects.toThrow("Connection failed");
    });
  });

  describe("getNextHeight", () => {
    it("should return startHeight when no blocks exist", async () => {
      mockClient.query.mockResolvedValue({
        rowCount: 0,
        rows: [],
      });

      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      const height = await indexer.getNextHeight();

      expect(height).toBe(config.startHeight);
      expect(mockClient.query).toHaveBeenCalledWith(
        "SELECT * FROM blocks ORDER BY height DESC LIMIT 1",
      );
    });

    it("should return next height when blocks exist", async () => {
      mockClient.query.mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            height: "100",
          },
        ],
      });

      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      const height = await indexer.getNextHeight();

      expect(height).toBe(101);
    });

    it("should handle database query errors", async () => {
      const queryError = new Error("Query failed");
      mockClient.query.mockRejectedValue(queryError);

      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      await expect(indexer.getNextHeight()).rejects.toThrow("Query failed");
    });
  });

  describe("shouldProcessGenesis", () => {
    it("should return false when processGenesis is not configured", async () => {
      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      const shouldProcess = await indexer.shouldProcessGenesis();
      expect(shouldProcess).toBe(false);
    });

    it("should return true when no blocks exist and startHeight is 1", async () => {
      mockClient.query.mockResolvedValue({
        rowCount: 0,
        rows: [],
      });

      const config = createTestConfig();
      const genesisConfig = {
        ...config,
        processGenesis: true,
        startHeight: 1,
      };

      const indexer = new PgIndexer(genesisConfig);
      const shouldProcess = await indexer.shouldProcessGenesis();

      expect(shouldProcess).toBe(true);
    });

    it("should return false when blocks already exist", async () => {
      mockClient.query.mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            height: "1",
          },
        ],
      });

      const config = createTestConfig();
      const genesisConfig = {
        ...config,
        processGenesis: true,
        startHeight: 1,
      };

      const indexer = new PgIndexer(genesisConfig);
      const shouldProcess = await indexer.shouldProcessGenesis();

      expect(shouldProcess).toBe(false);
    });

    it("should return false when startHeight is not 1", async () => {
      mockClient.query.mockResolvedValue({
        rowCount: 0,
        rows: [],
      });

      const config = createTestConfig();
      const genesisConfig = {
        ...config,
        processGenesis: true,
        startHeight: 100,
      };

      const indexer = new PgIndexer(genesisConfig);
      const shouldProcess = await indexer.shouldProcessGenesis();

      expect(shouldProcess).toBe(false);
    });
  });

  describe("Transaction Lifecycle", () => {
    it("should begin transaction successfully", async () => {
      mockClient.query.mockResolvedValue(undefined);

      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      await indexer.beginTransaction();

      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
    });

    it("should commit transaction on success", async () => {
      mockClient.query.mockResolvedValue(undefined);

      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      await indexer.beginTransaction();
      await indexer.endTransaction(true);

      expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
    });

    it("should rollback transaction on failure", async () => {
      mockClient.query.mockResolvedValue(undefined);

      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      await indexer.beginTransaction();
      await indexer.endTransaction(false);

      expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
    });

    it("should handle transaction errors", async () => {
      const transactionError = new Error("Transaction failed");
      mockClient.query.mockRejectedValue(transactionError);

      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      await expect(indexer.beginTransaction()).rejects.toThrow("Transaction failed");
    });

    it("should handle commit errors", async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Commit failed"));

      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      await indexer.beginTransaction();
      await expect(indexer.endTransaction(true)).rejects.toThrow("Commit failed");
    });

    it("should handle rollback errors", async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Rollback failed"));

      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      await indexer.beginTransaction();
      await expect(indexer.endTransaction(false)).rejects.toThrow("Rollback failed");
    });
  });

  describe("Database Client Recycling", () => {
    it("should recycle client after successful commits", async () => {
      mockClient.query.mockResolvedValue(undefined);

      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      const initialClientCount = (Client as unknown as {
        mock: {
          calls: unknown[]
        }
      }).mock.calls.length;

      for (let i = 0; i < DB_CLIENT_RECYCLE_COUNT; i++) {
        await indexer.beginTransaction();
        await indexer.endTransaction(true);
      }

      expect(mockClient.end).toHaveBeenCalled();
      expect((Client as unknown as {
        mock: {
          calls: unknown[]
        }
      }).mock.calls.length).toBe(initialClientCount + 1);
    });

    it("should not recycle client on rollback", async () => {
      mockClient.query.mockResolvedValue(undefined);

      const config = createTestConfig();
      const indexer = new PgIndexer(config);

      for (let i = 0; i < DB_CLIENT_RECYCLE_COUNT + 10; i++) {
        await indexer.beginTransaction();
        await indexer.endTransaction(false);
      }

      expect(mockClient.end).not.toHaveBeenCalled();
    });

    it("should reset counter after recycling", async () => {
      mockClient.query.mockResolvedValue(undefined);

      const config = createTestConfig();
      const indexer = new PgIndexer(config);

      for (let i = 0; i < DB_CLIENT_RECYCLE_COUNT; i++) {
        await indexer.beginTransaction();
        await indexer.endTransaction(true);
      }

      const firstRecycleCount = mockClient.end.mock.calls.length;

      for (let i = 0; i < DB_CLIENT_RECYCLE_COUNT; i++) {
        await indexer.beginTransaction();
        await indexer.endTransaction(true);
      }

      const secondRecycleCount = mockClient.end.mock.calls.length;

      expect(secondRecycleCount).toBe(firstRecycleCount + 1);
    });
  });
});
