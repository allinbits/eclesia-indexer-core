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
  applyMigrations: vi.fn().mockResolvedValue(0),
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
    it("applies the module's migrations through the indexer", async () => {
      bankModule.init(mockPgIndexer as unknown as PgIndexer);

      await bankModule.setup();

      expect(mockPgIndexer.applyMigrations).toHaveBeenCalledWith(
        bankModule.name,
        expect.arrayContaining([
          expect.objectContaining({
            version: 1,
            name: "initial",
          }),
        ]),
        "balances",
      );
    });

    it("propagates migration failures", async () => {
      bankModule.init(mockPgIndexer as unknown as PgIndexer);
      mockPgIndexer.applyMigrations.mockRejectedValueOnce(new Error("Migration 2 failed"));

      await expect(bankModule.setup()).rejects.toThrow("Migration 2 failed");
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

  describe("genesis/array/app_state.bank.balances", () => {
    it("sends one JSON coin list per account and unpacks it server-side", async () => {
      bankModule.init(mockPgIndexer as unknown as PgIndexer);
      const handler = mockOn.mock.calls.find(
        (call: unknown[]) => call[0] === "genesis/array/app_state.bank.balances",
      )?.[1];
      mockQuery.mockResolvedValue(undefined);

      const event = {
        value: [
          {
            address: "cosmos1multi",
            coins: [
              {
                denom: "uatom",
                amount: "100",
              },
              {
                denom: "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
                amount: "50",
              },
            ],
          },
          {
            address: "cosmos1empty",
            coins: [],
          },
        ],
      };

      expect(handler).toBeDefined();
      await handler!(event);

      expect(mockPgIndexer.modules["cosmos.auth.v1beta1"].assertAccounts).toHaveBeenCalledWith(["cosmos1multi", "cosmos1empty"]);
      const insert = mockQuery.mock.calls.find(call => call[0]?.name === "save-genesis-balances")?.[0];
      expect(insert).toBeDefined();
      // A multi-denom account used to be serialised as a single malformed COIN[] element
      expect(insert.values).toEqual([["cosmos1multi", "cosmos1empty"], ["[{\"denom\":\"uatom\",\"amount\":\"100\"},{\"denom\":\"ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2\",\"amount\":\"50\"}]", "[]"]]);
      expect(insert.text).toContain("jsonb_array_elements(b::jsonb)");
      expect(insert.text).toContain("::COIN");
    });
  });

  describe("decreaseBalance", () => {
    it("records a spend on a denom never seen before as a negative delta", async () => {
      bankModule.init(mockPgIndexer as unknown as PgIndexer);
      vi.spyOn(bankModule, "getBalance").mockResolvedValue([
        {
          denom: "uatom",
          amount: "500",
        },
      ]);
      const save = vi.spyOn(bankModule, "saveBalance").mockResolvedValue(undefined);

      await bankModule.decreaseBalance("cosmos1escrow", "100uatom,25uphoton", 700);

      expect(save).toHaveBeenCalledWith("cosmos1escrow", [
        {
          denom: "uatom",
          amount: "400",
        },
        {
          denom: "uphoton",
          amount: "-25",
        },
      ], 700);
    });
  });

  describe("eventHandler", () => {
    const attrs = (pairs: Record<string, string>) => Object.entries(pairs).map(([key, value]) => ({
      key,
      value,
    }));

    it("applies a mint once: coinbase duplicates the coin_received the keeper already emitted", async () => {
      bankModule.init(mockPgIndexer as unknown as PgIndexer);
      const increase = vi.spyOn(bankModule, "increaseBalance").mockResolvedValue(undefined);
      const decrease = vi.spyOn(bankModule, "decreaseBalance").mockResolvedValue(undefined);

      // The begin-block events the SDK mint module produces: MintCoins then a transfer to the fee collector
      await bankModule.eventHandler({
        height: 1722,
        value: [
          {
            type: "coin_received",
            attributes: attrs({
              receiver: "cosmos1mint",
              amount: "3214915uatom",
            }),
          },
          {
            type: "coinbase",
            attributes: attrs({
              minter: "cosmos1mint",
              amount: "3214915uatom",
            }),
          },
          {
            type: "coin_spent",
            attributes: attrs({
              spender: "cosmos1mint",
              amount: "3214915uatom",
            }),
          },
          {
            type: "coin_received",
            attributes: attrs({
              receiver: "cosmos1feecollector",
              amount: "3214915uatom",
            }),
          },
          {
            type: "transfer",
            attributes: attrs({
              recipient: "cosmos1feecollector",
              sender: "cosmos1mint",
              amount: "3214915uatom",
            }),
          },
        ],
      });

      expect(increase.mock.calls).toEqual([["cosmos1mint", "3214915uatom", 1722], ["cosmos1feecollector", "3214915uatom", 1722]]);
      expect(decrease.mock.calls).toEqual([["cosmos1mint", "3214915uatom", 1722]]);
    });

    it("applies a burn once: burn duplicates the coin_spent the keeper already emitted", async () => {
      bankModule.init(mockPgIndexer as unknown as PgIndexer);
      const increase = vi.spyOn(bankModule, "increaseBalance").mockResolvedValue(undefined);
      const decrease = vi.spyOn(bankModule, "decreaseBalance").mockResolvedValue(undefined);

      await bankModule.eventHandler({
        height: 900,
        value: [
          {
            type: "coin_spent",
            attributes: attrs({
              spender: "cosmos1gov",
              amount: "512000000uatom",
            }),
          },
          {
            type: "burn",
            attributes: attrs({
              burner: "cosmos1gov",
              amount: "512000000uatom",
            }),
          },
        ],
      });

      expect(decrease.mock.calls).toEqual([["cosmos1gov", "512000000uatom", 900]]);
      expect(increase).not.toHaveBeenCalled();
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
