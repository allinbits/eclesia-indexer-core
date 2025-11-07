import {
  PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  beforeEach, describe, expect, it, vi,
} from "vitest";

import {
  StakingModule,
} from "../index";

/**
 * Unit tests for StakingModule
 * Tests validator management, delegation tracking, and staking operations
 */

// Mock dependencies
const mockQuery = vi.fn();
const mockOn = vi.fn();
const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  verbose: vi.fn(),
  debug: vi.fn(),
  silly: vi.fn(),
};

const mockPgIndexer = {
  getInstance: vi.fn(function () {
    return {
      query: mockQuery,
    };
  }),
  beginTransaction: vi.fn().mockResolvedValue(undefined),
  endTransaction: vi.fn().mockResolvedValue(undefined),
  indexer: {
    log: mockLog,
    on: mockOn,
    callABCI: vi.fn(),
  },
  modules: {
  },
};

describe("StakingModule", () => {
  let stakingModule: StakingModule;

  beforeEach(() => {
    vi.clearAllMocks();
    stakingModule = new StakingModule([]);
  });

  describe("Module Properties", () => {
    it("should have correct module name", () => {
      expect(stakingModule.name).toBe("cosmos.staking.v1beta1");
    });

    it("should depend on auth module", () => {
      expect(stakingModule.depends).toEqual(["cosmos.auth.v1beta1"]);
    });

    it("should provide cosmos.staking.v1beta1", () => {
      expect(stakingModule.provides).toEqual(["cosmos.staking.v1beta1"]);
    });
  });

  describe("setup", () => {
    it("should skip setup if tables already exist", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            exists: true,
          },
        ],
      });

      await stakingModule.init(mockPgIndexer as unknown as PgIndexer);
      await stakingModule.setup();

      expect(mockPgIndexer.beginTransaction).toHaveBeenCalled();
      expect(mockPgIndexer.endTransaction).toHaveBeenCalledWith(true);
      expect(mockLog.warn).not.toHaveBeenCalled();
    });

    it("should create tables if they do not exist", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              exists: false,
            },
          ],
        })
        .mockResolvedValueOnce(undefined) // CREATE TABLE query
        .mockResolvedValueOnce({
          rows: [], // cacheValidatorData query
        });

      await stakingModule.init(mockPgIndexer as unknown as PgIndexer);
      await stakingModule.setup();

      expect(mockLog.warn).toHaveBeenCalledWith("Database not configured");
      expect(mockLog.info).toHaveBeenCalledWith("DB has been set up");
      expect(mockPgIndexer.endTransaction).toHaveBeenCalledWith(true);
    });

    it("should handle setup errors", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              exists: false,
            },
          ],
        })
        .mockRejectedValueOnce(new Error("SQL error"));

      await stakingModule.init(mockPgIndexer as unknown as PgIndexer);

      await expect(stakingModule.setup()).rejects.toThrow("SQL error");
      expect(mockPgIndexer.endTransaction).toHaveBeenCalledWith(false);
    });
  });

  describe("init", () => {
    it("should register event handlers", async () => {
      await stakingModule.init(mockPgIndexer as unknown as PgIndexer);

      expect(mockOn).toHaveBeenCalled();
      expect(mockOn.mock.calls.length).toBeGreaterThan(0);
    });

    it("should set pgIndexer and indexer references", async () => {
      await stakingModule.init(mockPgIndexer as unknown as PgIndexer);

      expect(stakingModule.indexer).toBe(mockPgIndexer.indexer);
    });
  });

  describe("savePool", () => {
    beforeEach(async () => {
      await stakingModule.init(mockPgIndexer as unknown as PgIndexer);
    });

    it("should save pool data with height", async () => {
      mockQuery.mockResolvedValueOnce(undefined);

      const pool = {
        bondedTokens: "1000000000",
        notBondedTokens: "500000000",
      };

      await stakingModule.savePool(pool, 12345);

      expect(mockQuery).toHaveBeenCalledWith(
        "INSERT INTO staking_pool(bonded_tokens,not_bonded_tokens,height) VALUES($1,$2,$3) ON CONFLICT ON CONSTRAINT unique_pool DO NOTHING",
        ["1000000000", "500000000", 12345],
      );
    });

    it("should save pool without height", async () => {
      mockQuery.mockResolvedValueOnce(undefined);

      const pool = {
        bondedTokens: "2000000000",
        notBondedTokens: "1000000000",
      };

      await stakingModule.savePool(pool);

      expect(mockQuery).toHaveBeenCalledWith(
        "INSERT INTO staking_pool(bonded_tokens,not_bonded_tokens,height) VALUES($1,$2,$3) ON CONFLICT ON CONSTRAINT unique_pool DO NOTHING",
        ["2000000000", "1000000000", undefined],
      );
    });
  });
});
