import {
  PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  beforeEach, describe, expect, it, vi,
} from "vitest";

import {
  BankModule,
} from "../index";

/**
 * Unit tests for BankModule
 * Tests balance tracking and coin transfer logic
 */

// Mock dependencies
const mockQuery = vi.fn();
const mockOn = vi.fn();
const mockCallABCI = vi.fn();
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
    callABCI: mockCallABCI,
  },
  modules: {
    "cosmos.auth.v1beta1": {
      assertAccounts: vi.fn().mockResolvedValue(undefined),
      assertAccount: vi.fn().mockResolvedValue(undefined),
    },
  },
};

describe("BankModule", () => {
  let bankModule: BankModule;

  beforeEach(() => {
    vi.clearAllMocks();
    bankModule = new BankModule([]);
    mockQuery.mockReset();
  });

  describe("Module Properties", () => {
    it("should have correct module name", () => {
      expect(bankModule.name).toBe("cosmos.bank.v1beta1");
    });

    it("should depend on auth module", () => {
      expect(bankModule.depends).toEqual(["cosmos.auth.v1beta1"]);
    });

    it("should provide cosmos.bank.v1beta1", () => {
      expect(bankModule.provides).toEqual(["cosmos.bank.v1beta1"]);
    });
  });

  describe("setup", () => {
    it("should skip setup if table already exists", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            exists: true,
          },
        ],
      });

      bankModule.init(mockPgIndexer as unknown as PgIndexer);
      await bankModule.setup();

      expect(mockPgIndexer.beginTransaction).toHaveBeenCalled();
      expect(mockPgIndexer.endTransaction).toHaveBeenCalledWith(true);
      expect(mockLog.warn).not.toHaveBeenCalled();
    });

    it("should create table if it does not exist", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              exists: false,
            },
          ],
        })
        .mockResolvedValueOnce(undefined);

      bankModule.init(mockPgIndexer as unknown as PgIndexer);
      await bankModule.setup();

      expect(mockLog.warn).toHaveBeenCalledWith("Database not configured");
      expect(mockLog.info).toHaveBeenCalledWith("DB has been set up");
      expect(mockPgIndexer.endTransaction).toHaveBeenCalledWith(true);
    });

    it("should rollback transaction on error", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              exists: false,
            },
          ],
        })
        .mockRejectedValueOnce(new Error("SQL error"));

      bankModule.init(mockPgIndexer as unknown as PgIndexer);

      await expect(bankModule.setup()).rejects.toThrow("SQL error");
      expect(mockPgIndexer.endTransaction).toHaveBeenCalledWith(false);
    });
  });

  describe("init", () => {
    it("should register event handlers", () => {
      bankModule.init(mockPgIndexer as unknown as PgIndexer);

      expect(mockOn).toHaveBeenCalled();
      expect(mockOn.mock.calls.length).toBeGreaterThan(0);
    });

    it("should set pgIndexer and indexer references", () => {
      bankModule.init(mockPgIndexer as unknown as PgIndexer);

      expect(bankModule.indexer).toBe(mockPgIndexer.indexer);
    });
  });

  describe("saveGenesisBalance", () => {
    beforeEach(() => {
      bankModule.init(mockPgIndexer as unknown as PgIndexer);
    });

    it("should save genesis balance", async () => {
      mockQuery.mockResolvedValueOnce(undefined);

      const coins = [
        {
          denom: "uatom",
          amount: "1000000",
        },
        {
          denom: "stake",
          amount: "2000000",
        },
      ];

      await bankModule.saveGenesisBalance("cosmos1test", coins);

      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe("saveBalance", () => {
    beforeEach(() => {
      bankModule.init(mockPgIndexer as unknown as PgIndexer);
    });

    it("should save balance at specific height", async () => {
      mockQuery.mockResolvedValueOnce(undefined);

      const coins = [
        {
          denom: "uatom",
          amount: "5000000",
        },
      ];

      await bankModule.saveBalance("cosmos1test", coins, 100);

      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe("getBalance", () => {
    beforeEach(() => {
      bankModule.init(mockPgIndexer as unknown as PgIndexer);
    });

    it("should return balance from database", async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            to_json: [
              {
                denom: "uatom",
                amount: "1000000",
              },
            ],
          },
        ],
      });

      const balance = await bankModule.getBalance("cosmos1test", 100);

      expect(balance).toEqual([
        {
          denom: "uatom",
          amount: "1000000",
        },
      ]);
      expect(mockQuery).toHaveBeenCalled();
    });

    it("should return empty array when no balance exists", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rowCount: 0,
          rows: [],
        })
        .mockResolvedValueOnce({
          rowCount: 0,
          rows: [],
        });

      const balance = await bankModule.getBalance("cosmos1test", 100);

      expect(balance).toEqual([]);
    });
  });
});
