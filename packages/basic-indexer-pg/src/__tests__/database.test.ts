/* eslint-disable max-lines-per-function */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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
  loadMigrations, Migration, PgIndexer,
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
        stop: vi.fn().mockResolvedValue(undefined),
      };
    }),
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
        .mockResolvedValueOnce(undefined) // SET synchronous_commit
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error("Commit failed"));

      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      await indexer.beginTransaction();
      await expect(indexer.endTransaction(true)).rejects.toThrow("Commit failed");
    });

    it("should handle rollback errors", async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined) // SET synchronous_commit
        .mockResolvedValueOnce(undefined) // BEGIN
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

  describe("Reconnection", () => {
    const clientConstructions = () => (Client as unknown as {
      mock: {
        calls: unknown[]
      }
    }).mock.calls.length;
    const fireEnd = () => {
      const endListener = mockClient.on.mock.calls.find(call => call[0] === "end")?.[1];
      expect(endListener).toBeDefined();
      endListener();
    };

    it("builds a fresh client with listeners after the connection ends", async () => {
      const indexer = new PgIndexer(createTestConfig());
      await indexer.getNextHeight();
      const before = clientConstructions();

      fireEnd();
      await indexer.beginTransaction();

      expect(clientConstructions()).toBe(before + 1);
      expect(mockClient.connect).toHaveBeenCalledTimes(2);
      expect(mockClient.on.mock.calls.filter(call => call[0] === "error").length).toBeGreaterThanOrEqual(2);
      expect(mockClient.on.mock.calls.filter(call => call[0] === "end").length).toBeGreaterThanOrEqual(2);
    });

    it("retries with a fresh client after a failed connect instead of reusing the dead one", async () => {
      mockClient.connect.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      const indexer = new PgIndexer(createTestConfig());
      const before = clientConstructions();

      await expect(indexer.beginTransaction()).rejects.toThrow("ECONNREFUSED");
      await indexer.beginTransaction();

      expect(clientConstructions()).toBe(before + 1);
      expect(mockClient.connect).toHaveBeenCalledTimes(2);
      expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
    });

    it("reconnects through the same path after recycling", async () => {
      mockClient.query.mockResolvedValue(undefined);
      const indexer = new PgIndexer(createTestConfig());

      for (let i = 0; i < DB_CLIENT_RECYCLE_COUNT; i++) {
        await indexer.beginTransaction();
        await indexer.endTransaction(true);
      }

      expect(mockClient.end).toHaveBeenCalledTimes(1);
      expect(mockClient.connect).toHaveBeenCalledTimes(2);
    });
  });

  describe("stop", () => {
    it("stops the engine and ends the database client", async () => {
      const indexer = new PgIndexer(createTestConfig());
      await indexer.getNextHeight();

      await indexer.stop();

      expect((indexer.indexer.stop as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
      expect(mockClient.end).toHaveBeenCalledTimes(1);
    });
  });

  describe("migrations", () => {
    const migrations: Migration[] = [
      {
        version: 1,
        name: "initial",
        sql: "CREATE TABLE things (id INT)",
      },
      {
        version: 2,
        name: "add_column",
        sql: "ALTER TABLE things ADD COLUMN name TEXT",
      },
    ];
    const sqlCalls = () => mockClient.query.mock.calls.map(call => (typeof call[0] === "string" ? call[0] : call[0].text));

    /** Answers the bookkeeping queries; everything else resolves to an empty result */
    const answer = (appliedVersions: number[], baselineExists: boolean) => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (typeof sql === "string" && sql.startsWith("SELECT version FROM schema_migrations")) {
          return {
            rowCount: appliedVersions.length,
            rows: appliedVersions.map(version => ({
              version,
            })),
          };
        }
        if (typeof sql === "string" && sql.startsWith("SELECT EXISTS")) {
          return {
            rowCount: 1,
            rows: [
              {
                exists: baselineExists,
              },
            ],
          };
        }
        return {
          rowCount: 0,
          rows: [],
        };
      });
    };

    it("runs every migration on a fresh database and records each one", async () => {
      answer([], false);
      const indexer = new PgIndexer(createTestConfig());

      const applied = await indexer.applyMigrations("test-module", migrations, "things");

      expect(applied).toBe(2);
      const calls = sqlCalls();
      expect(calls).toContain("CREATE TABLE things (id INT)");
      expect(calls).toContain("ALTER TABLE things ADD COLUMN name TEXT");
      const inserts = mockClient.query.mock.calls.filter(call => typeof call[0] === "string" && call[0].startsWith("INSERT INTO schema_migrations"));
      expect(inserts.map(call => call[1])).toEqual([["test-module", 1, "initial"], ["test-module", 2, "add_column"]]);
      // each migration commits on its own, after the bookkeeping transaction
      expect(calls.filter(sql => sql === "COMMIT").length).toBe(3);
    });

    it("baselines a database created before migrations existed and applies only the rest", async () => {
      answer([], true);
      const indexer = new PgIndexer(createTestConfig());

      const applied = await indexer.applyMigrations("test-module", migrations, "things");

      expect(applied).toBe(1);
      const calls = sqlCalls();
      expect(calls).not.toContain("CREATE TABLE things (id INT)");
      expect(calls).toContain("ALTER TABLE things ADD COLUMN name TEXT");
      const inserts = mockClient.query.mock.calls.filter(call => typeof call[0] === "string" && call[0].startsWith("INSERT INTO schema_migrations"));
      expect(inserts.map(call => call[1])).toEqual([["test-module", 1, "initial (baseline)"], ["test-module", 2, "add_column"]]);
    });

    it("does nothing when everything is already applied", async () => {
      answer([1, 2], true);
      const indexer = new PgIndexer(createTestConfig());

      const applied = await indexer.applyMigrations("test-module", migrations, "things");

      expect(applied).toBe(0);
      expect(sqlCalls()).not.toContain("ALTER TABLE things ADD COLUMN name TEXT");
    });

    it("rolls back and rethrows when a migration fails", async () => {
      answer([1], true);
      const base = mockClient.query.getMockImplementation()!;
      mockClient.query.mockImplementation(async (sql: string, values?: unknown[]) => {
        if (sql === "BROKEN") {
          throw new Error("syntax error");
        }
        return base(sql, values);
      });
      const indexer = new PgIndexer(createTestConfig());
      const failing = migrations.map(m => (m.version === 2
        ? {
          ...m,
          sql: "BROKEN",
        }
        : m));

      await expect(indexer.applyMigrations("test-module", failing, "things")).rejects.toThrow("Migration 2 (add_column) for test-module failed");
      expect(sqlCalls()).toContain("ROLLBACK");
      const inserts = mockClient.query.mock.calls.filter(call => typeof call[0] === "string" && call[0].startsWith("INSERT INTO schema_migrations"));
      expect(inserts.length).toBe(0);
    });

    it("rejects duplicate or non-positive versions", async () => {
      const indexer = new PgIndexer(createTestConfig());
      await expect(indexer.applyMigrations("m", [
        migrations[0],
        {
          ...migrations[0],
        },
      ], "things")).rejects.toThrow("unique positive integers");
      await expect(indexer.applyMigrations("m", [
        {
          ...migrations[0],
          version: 0,
        },
      ], "things")).rejects.toThrow("unique positive integers");
    });

    it("loadMigrations orders files by numeric prefix and ignores others", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eclesia-migrations-"));
      fs.writeFileSync(path.join(dir, "010_late.sql"), "SELECT 10");
      fs.writeFileSync(path.join(dir, "002_second.sql"), "SELECT 2");
      fs.writeFileSync(path.join(dir, "001_initial.sql"), "SELECT 1");
      fs.writeFileSync(path.join(dir, "README.md"), "not a migration");

      const loaded = loadMigrations(dir);

      expect(loaded.map(m => [m.version, m.name, m.sql])).toEqual([[1, "initial", "SELECT 1"], [2, "second", "SELECT 2"], [10, "late", "SELECT 10"]]);
    });
  });

  describe("synchronous_commit", () => {
    it("is switched off once per connection by default", async () => {
      const indexer = new PgIndexer(createTestConfig());
      await indexer.getNextHeight();
      await indexer.getNextHeight();
      indexer.getInstance();

      const sets = mockClient.query.mock.calls.filter(call => typeof call[0] === "string" && call[0].startsWith("SET synchronous_commit"));
      expect(sets.length).toBe(1);
    });

    it("stays on when synchronousCommit is true", async () => {
      const indexer = new PgIndexer({
        ...createTestConfig(),
        synchronousCommit: true,
      });
      await indexer.getNextHeight();

      const sets = mockClient.query.mock.calls.filter(call => typeof call[0] === "string" && call[0].startsWith("SET synchronous_commit"));
      expect(sets.length).toBe(0);
    });
  });

  describe("genesis import tracking", () => {
    const answerGenesis = (status: string | null, blocks: number) => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (typeof sql === "string" && sql.startsWith("SELECT status FROM genesis_import")) {
          return status
            ? {
              rowCount: 1,
              rows: [
                {
                  status,
                },
              ],
            }
            : {
              rowCount: 0,
              rows: [],
            };
        }
        if (typeof sql === "string" && sql.startsWith("SELECT * FROM blocks")) {
          return {
            rowCount: blocks,
            rows: blocks
              ? [
                {
                  height: blocks,
                },
              ]
              : [],
          };
        }
        return {
          rowCount: 0,
          rows: [],
        };
      });
    };
    const genesisConfig = () => ({
      ...createTestConfig(),
      processGenesis: true,
    });

    it("refuses to start on top of a partial import", async () => {
      answerGenesis("in_progress", 0);
      const indexer = new PgIndexer(genesisConfig());
      await expect(indexer.shouldProcessGenesis()).rejects.toThrow("did not complete");
    });

    it("does not import again once complete, even with no blocks yet", async () => {
      answerGenesis("complete", 0);
      const indexer = new PgIndexer(genesisConfig());
      await expect(indexer.shouldProcessGenesis()).resolves.toBe(false);
    });

    it("imports on a fresh database from height 1", async () => {
      answerGenesis(null, 0);
      const indexer = new PgIndexer(genesisConfig());
      await expect(indexer.shouldProcessGenesis()).resolves.toBe(true);
    });

    it("records start and completion", async () => {
      answerGenesis(null, 0);
      const indexer = new PgIndexer(genesisConfig());
      await indexer["onGenesisStart"]();
      await indexer["onGenesisComplete"]();
      const sql = mockClient.query.mock.calls.map(call => (typeof call[0] === "string" ? call[0] : call[0].text));
      expect(sql.some(q => q.startsWith("INSERT INTO genesis_import(status) VALUES ('in_progress')"))).toBe(true);
      expect(sql.some(q => q.startsWith("UPDATE genesis_import SET status = 'complete'"))).toBe(true);
    });
  });
});
