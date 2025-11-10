import {
  PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  beforeEach, describe, expect, it, vi,
} from "vitest";

import {
  AuthModule,
} from "../index";

/**
 * Unit tests for AuthModule
 * Tests account management and genesis account processing
 */

// Mock dependencies
const mockQuery = vi.fn();
const mockOn = vi.fn();
const mockAsyncEmit = vi.fn();
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
    asyncEmit: mockAsyncEmit,
    callABCI: vi.fn(),
  },
  modules: {
  },
};

describe("AuthModule", () => {
  let authModule: AuthModule;

  beforeEach(() => {
    vi.clearAllMocks();
    authModule = new AuthModule([]);
  });

  describe("Module Properties", () => {
    it("should have correct module name", () => {
      expect(authModule.name).toBe("cosmos.auth.v1beta1");
    });

    it("should have no dependencies", () => {
      expect(authModule.depends).toEqual([]);
    });

    it("should provide cosmos.auth.v1beta1", () => {
      expect(authModule.provides).toEqual(["cosmos.auth.v1beta1"]);
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

      authModule.init(mockPgIndexer as unknown as PgIndexer);
      await authModule.setup();

      expect(mockPgIndexer.beginTransaction).toHaveBeenCalled();
      expect(mockPgIndexer.endTransaction).toHaveBeenCalledWith(true);
      expect(mockLog.warn).not.toHaveBeenCalled();
    });

    it("should handle setup errors gracefully", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              exists: false,
            },
          ],
        })
        .mockRejectedValueOnce(new Error("SQL error"));

      authModule.init(mockPgIndexer as unknown as PgIndexer);

      await expect(authModule.setup()).rejects.toThrow("SQL error");
      expect(mockPgIndexer.endTransaction).toHaveBeenCalledWith(false);
    });
  });

  describe("init", () => {
    it("should register event handlers", () => {
      authModule.init(mockPgIndexer as unknown as PgIndexer);

      expect(mockOn).toHaveBeenCalledWith("block", expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith(
        "genesis/array/app_state.auth.accounts",
        expect.any(Function),
      );
    });

    it("should set pgIndexer and indexer references", () => {
      authModule.init(mockPgIndexer as unknown as PgIndexer);

      expect(authModule.indexer).toBe(mockPgIndexer.indexer);
    });
  });

  describe("assertAccount", () => {
    beforeEach(() => {
      authModule.init(mockPgIndexer as unknown as PgIndexer);
    });

    it("should insert account if it does not exist", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rowCount: 0,
        })
        .mockResolvedValueOnce(undefined);

      await authModule.assertAccount("cosmos1test");

      expect(mockQuery).toHaveBeenCalledWith(
        "SELECT address from accounts WHERE address=$1",
        ["cosmos1test"],
      );
      expect(mockQuery).toHaveBeenCalledWith({
        name: "assert_account",
        text: "INSERT INTO accounts(address) values($1)",
        values: ["cosmos1test"],
      });
    });

    it("should skip insert if account already exists", async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            address: "cosmos1test",
          },
        ],
      });

      await authModule.assertAccount("cosmos1test");

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe("assertAccounts", () => {
    beforeEach(() => {
      authModule.init(mockPgIndexer as unknown as PgIndexer);
    });

    it("should insert multiple accounts in single query", async () => {
      const addresses = ["cosmos1addr1", "cosmos1addr2", "cosmos1addr3"];

      await authModule.assertAccounts(addresses);

      expect(mockQuery).toHaveBeenCalledWith({
        name: "assert_accounts",
        text: "INSERT INTO accounts(address) SELECT * FROM UNNEST($1::text[]) ON CONFLICT DO NOTHING",
        values: [addresses],
      });
    });

    it("should handle empty array", async () => {
      await authModule.assertAccounts([]);

      expect(mockQuery).toHaveBeenCalledWith({
        name: "assert_accounts",
        text: "INSERT INTO accounts(address) SELECT * FROM UNNEST($1::text[]) ON CONFLICT DO NOTHING",
        values: [[]],
      });
    });
  });

  describe("Genesis Account Processing", () => {
    it("should process base accounts from genesis", async () => {
      authModule.init(mockPgIndexer as unknown as PgIndexer);

      const genesisHandler = mockOn.mock.calls.find(
        (call: [string, (event: unknown) => Promise<void>]) => call[0] === "genesis/array/app_state.auth.accounts",
      )?.[1];

      mockQuery.mockResolvedValue(undefined);

      const event = {
        value: [
          {
            "@type": "/cosmos.auth.v1beta1.BaseAccount",
            address: "cosmos1account1",
          },
          {
            "@type": "/cosmos.auth.v1beta1.BaseAccount",
            address: "cosmos1account2",
          },
        ],
      };

      if (genesisHandler) {
        await genesisHandler(event);
      }

      expect(mockQuery).toHaveBeenCalledWith({
        name: "assert_accounts",
        text: "INSERT INTO accounts(address) SELECT * FROM UNNEST($1::text[]) ON CONFLICT DO NOTHING",
        values: [["cosmos1account1", "cosmos1account2"]],
      });
    });

    it("should process module accounts from genesis", async () => {
      authModule.init(mockPgIndexer as unknown as PgIndexer);

      const genesisHandler = mockOn.mock.calls.find(
        (call: [string, (event: unknown) => Promise<void>]) => call[0] === "genesis/array/app_state.auth.accounts",
      )?.[1];

      mockQuery.mockResolvedValue(undefined);

      const event = {
        value: [
          {
            "@type": "/cosmos.auth.v1beta1.ModuleAccount",
            base_account: {
              address: "cosmos1moduleaccount",
            },
          },
        ],
      };

      if (genesisHandler) {
        await genesisHandler(event);
      }

      expect(mockQuery).toHaveBeenCalledWith({
        name: "assert_accounts",
        text: "INSERT INTO accounts(address) SELECT * FROM UNNEST($1::text[]) ON CONFLICT DO NOTHING",
        values: [["cosmos1moduleaccount"]],
      });
    });

    it("should process vesting accounts from genesis", async () => {
      authModule.init(mockPgIndexer as unknown as PgIndexer);

      const genesisHandler = mockOn.mock.calls.find(
        (call: [string, (event: unknown) => Promise<void>]) => call[0] === "genesis/array/app_state.auth.accounts",
      )?.[1];

      mockQuery.mockResolvedValue(undefined);

      const event = {
        value: [
          {
            "@type": "/cosmos.vesting.v1beta1.DelayedVestingAccount",
            base_vesting_account: {
              base_account: {
                address: "cosmos1vestingaccount",
              },
            },
          },
          {
            "@type": "/cosmos.vesting.v1beta1.ContinuousVestingAccount",
            base_vesting_account: {
              base_account: {
                address: "cosmos1continuousvesting",
              },
            },
          },
        ],
      };

      if (genesisHandler) {
        await genesisHandler(event);
      }

      expect(mockQuery).toHaveBeenCalledWith({
        name: "assert_accounts",
        text: "INSERT INTO accounts(address) SELECT * FROM UNNEST($1::text[]) ON CONFLICT DO NOTHING",
        values: [["cosmos1vestingaccount", "cosmos1continuousvesting"]],
      });
    });
  });
});
