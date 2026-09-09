import {
  PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  ModuleAccount,
} from "cosmjs-types/cosmos/auth/v1beta1/auth.js";
import {
  QueryModuleAccountsResponse,
} from "cosmjs-types/cosmos/auth/v1beta1/query.js";
import {
  afterEach, beforeEach, describe, expect, it, vi,
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
  applyMigrations: vi.fn().mockResolvedValue(0),
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
    it("applies the module's migrations through the indexer", async () => {
      authModule.init(mockPgIndexer as unknown as PgIndexer);

      await authModule.setup();

      expect(mockPgIndexer.applyMigrations).toHaveBeenCalledWith(
        authModule.name,
        expect.arrayContaining([
          expect.objectContaining({
            version: 1,
            name: "initial",
          }),
        ]),
        "accounts",
      );
    });

    it("propagates migration failures", async () => {
      authModule.init(mockPgIndexer as unknown as PgIndexer);
      mockPgIndexer.applyMigrations.mockRejectedValueOnce(new Error("Migration 2 failed"));

      await expect(authModule.setup()).rejects.toThrow("Migration 2 failed");
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
        (call: unknown[]) => call[0] === "genesis/array/app_state.auth.accounts",
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
        (call: unknown[]) => call[0] === "genesis/array/app_state.auth.accounts",
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
        (call: unknown[]) => call[0] === "genesis/array/app_state.auth.accounts",
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

    it("resolves every standard wrapper shape and skips unknown ones instead of inserting NULL", async () => {
      authModule.init(mockPgIndexer as unknown as PgIndexer);

      const genesisHandler = mockOn.mock.calls.find(
        (call: unknown[]) => call[0] === "genesis/array/app_state.auth.accounts",
      )?.[1];

      mockQuery.mockResolvedValue(undefined);

      const event = {
        value: [
          {
            "@type": "/cosmos.vesting.v1beta1.PeriodicVestingAccount",
            base_vesting_account: {
              base_account: {
                address: "cosmos1periodic",
              },
            },
          },
          {
            "@type": "/cosmos.vesting.v1beta1.PermanentLockedAccount",
            base_vesting_account: {
              base_account: {
                address: "cosmos1locked",
              },
            },
          },
          {
            "@type": "/ethermint.types.v1.EthAccount",
            base_account: {
              address: "evmos1eth",
            },
          },
          {
            "@type": "/ibc.applications.interchain_accounts.v1.InterchainAccount",
            base_account: {
              address: "cosmos1ica",
            },
          },
          {
            "@type": "/some.chain.v1.OpaqueAccount",
            inner: {
              address: "cosmos1unreachable",
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
        values: [["cosmos1periodic", "cosmos1locked", "evmos1eth", "cosmos1ica"]],
      });
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("/some.chain.v1.OpaqueAccount"));
    });
  });

  describe("module account snapshot", () => {
    const moduleAccountsResponse = (addresses: string[]) => QueryModuleAccountsResponse.encode(QueryModuleAccountsResponse.fromPartial({
      accounts: addresses.map(address => ({
        typeUrl: "/cosmos.auth.v1beta1.ModuleAccount",
        value: ModuleAccount.encode(ModuleAccount.fromPartial({
          baseAccount: {
            address,
          },
          name: address,
        })).finish(),
      })),
    })).finish();
    const blockEvent = (height: number) => ({
      value: {
        block: {
          block: {
            header: {
              height,
            },
          },
        },
      },
      height,
    });
    let bank: {
      getGenesisBalance: ReturnType<typeof vi.fn>
      saveBalance: ReturnType<typeof vi.fn>
    };

    beforeEach(() => {
      bank = {
        getGenesisBalance: vi.fn().mockResolvedValue([
          {
            denom: "uatom",
            amount: "42",
          },
        ]),
        saveBalance: vi.fn().mockResolvedValue(undefined),
      };
      (mockPgIndexer.modules as Record<string, unknown>)["cosmos.bank.v1beta1"] = bank;
      mockQuery.mockImplementation(async (sql: string) => (typeof sql === "string" && sql.includes("FROM blocks")
        ? {
          rowCount: 1,
          rows: [
            {
            },
          ],
        }
        : {
          rowCount: 0,
          rows: [
            {
              exists: false,
            },
          ],
        }));
      authModule.init(mockPgIndexer as unknown as PgIndexer);
    });

    afterEach(() => {
      delete (mockPgIndexer.modules as Record<string, unknown>)["cosmos.bank.v1beta1"];
    });

    const blockHandler = () => mockOn.mock.calls.find(
      (call: unknown[]) => call[0] === "block",
    )?.[1];

    it("writes each module account's end-of-block-1 balance at height 1 when block 2 starts", async () => {
      mockPgIndexer.indexer.callABCI.mockResolvedValue(moduleAccountsResponse(["cosmos1feecollector", "cosmos1distribution"]));

      await blockHandler()!(blockEvent(2));

      expect(mockPgIndexer.indexer.callABCI).toHaveBeenCalledWith("/cosmos.auth.v1beta1.Query/ModuleAccounts", expect.any(Uint8Array));
      expect(bank.saveBalance.mock.calls.map(call => [call[0], call[2]])).toEqual([["cosmos1feecollector", 1], ["cosmos1distribution", 1]]);
      expect(bank.getGenesisBalance).toHaveBeenCalledTimes(2);
    });

    it("does nothing on other heights", async () => {
      await blockHandler()!(blockEvent(1));
      await blockHandler()!(blockEvent(3));
      expect(mockPgIndexer.indexer.callABCI).not.toHaveBeenCalled();
      expect(bank.saveBalance).not.toHaveBeenCalled();
    });

    it("skips the snapshot when block 1 was never indexed", async () => {
      mockQuery.mockImplementation(async () => ({
        rowCount: 0,
        rows: [],
      }));
      await blockHandler()!(blockEvent(2));
      expect(mockPgIndexer.indexer.callABCI).not.toHaveBeenCalled();
    });

    it("falls back to well-known names when the chain lacks the ModuleAccounts query", async () => {
      mockPgIndexer.indexer.callABCI.mockRejectedValueOnce(new Error("ABCI query failed with code 6: unknown request"));
      vi.spyOn(authModule, "getModuleAccount").mockImplementation(async name => (name === "fee_collector" ? "cosmos1feecollector" : undefined));

      await blockHandler()!(blockEvent(2));

      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("falling back"), expect.anything());
      expect(bank.saveBalance.mock.calls.map(call => call[0])).toEqual(["cosmos1feecollector"]);
    });
  });
});
