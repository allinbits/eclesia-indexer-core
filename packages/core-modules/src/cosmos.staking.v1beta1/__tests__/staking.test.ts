/* eslint-disable max-lines-per-function */
import {
  createHash,
} from "node:crypto";

import {
  PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  Utils,
} from "@eclesia/indexer-engine";
import {
  bech32,
} from "bech32";
import {
  BigNumber,
} from "bignumber.js";
import {
  PubKey as EdPubKey,
} from "cosmjs-types/cosmos/crypto/ed25519/keys.js";
import {
  QueryDelegatorDelegationsRequest, QueryDelegatorDelegationsResponse, QueryParamsResponse,
} from "cosmjs-types/cosmos/staking/v1beta1/query.js";
import {
  Validator,
} from "cosmjs-types/cosmos/staking/v1beta1/staking.js";
import {
  MsgCancelUnbondingDelegation,
  MsgCreateValidator,
  MsgUndelegate,
} from "cosmjs-types/cosmos/staking/v1beta1/tx.js";
import {
  Any,
} from "cosmjs-types/google/protobuf/any.js";
import {
  beforeEach, describe, expect, it, vi,
} from "vitest";

import {
  consensusKeyHash, editedField, fromLegacyDec, StakingModule, unbondingSeconds,
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
  applyMigrations: vi.fn().mockResolvedValue(0),
  indexer: {
    log: mockLog,
    on: mockOn,
    callABCI: vi.fn(),
  },
  modules: {
    "blocks-full": {
    },
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

    it("should depend on auth and full blocks", () => {
      expect(stakingModule.depends).toEqual(["cosmos.auth.v1beta1", "blocks-full"]);
    });

    it("refuses to set up without the full blocks module", async () => {
      const without = {
        ...mockPgIndexer,
        modules: {
        },
      };
      await stakingModule.init(without as unknown as PgIndexer);
      await expect(stakingModule.setup()).rejects.toThrow("requires Blocks.FullBlocksModule");
    });

    it("should provide cosmos.staking.v1beta1", () => {
      expect(stakingModule.provides).toEqual(["cosmos.staking.v1beta1"]);
    });
  });

  describe("setup", () => {
    it("applies the module's migrations through the indexer", async () => {
      await stakingModule.init(mockPgIndexer as unknown as PgIndexer);
      mockQuery.mockResolvedValue({
        rowCount: 0,
        rows: [],
      });
      await stakingModule.setup();

      expect(mockPgIndexer.applyMigrations).toHaveBeenCalledWith(
        stakingModule.name,
        expect.arrayContaining([
          expect.objectContaining({
            version: 1,
            name: "initial",
          }),
        ]),
        "staking_params",
      );
    });

    it("propagates migration failures", async () => {
      await stakingModule.init(mockPgIndexer as unknown as PgIndexer);
      mockPgIndexer.applyMigrations.mockRejectedValueOnce(new Error("Migration 2 failed"));

      await expect(stakingModule.setup()).rejects.toThrow("Migration 2 failed");
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

  /**
   * Rows written from genesis/gentx carry a NULL height. PostgreSQL sorts NULLs
   * first on DESC, so every "latest row" lookup must say NULLS LAST or it reads
   * the genesis row forever. The (height DESC NULLS LAST) index does not change
   * query semantics, so the clause has to be in the query itself.
   */
  describe("latest-row lookups order NULL (genesis) heights last", () => {
    const LATEST_ROW = /ORDER BY height DESC NULLS LAST LIMIT 1$/;

    beforeEach(async () => {
      mockQuery.mockReset();
      await stakingModule.init(mockPgIndexer as unknown as PgIndexer);
    });

    it("getValidatorCommission", async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            commission: "0.1",
            height: 500,
          },
        ],
      });

      const row = await stakingModule.getValidatorCommission("atonevaloper1v");

      expect(row.height).toBe(500);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(LATEST_ROW), ["atonevaloper1v"]);
    });

    it("getValidatorDescription", async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            moniker: "edited",
            height: 500,
          },
        ],
      });

      const row = await stakingModule.getValidatorDescription("atonevaloper1v");

      expect(row.moniker).toBe("edited");
      expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(LATEST_ROW), ["atonevaloper1v"]);
    });

    it("delegate adds to the newest staked balance", async () => {
      stakingModule.validatorCache.set("atonevalcons1v", {
        status: "BOND_STATUS_BONDED",
        jailed: false,
        tokens: 1000n,
        delegator_shares: new BigNumber(1000),
      });
      mockQuery
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              to_json: {
                denom: "uatom",
                amount: "2500",
              },
              shares: "2500",
            },
          ],
        })
        .mockResolvedValueOnce(undefined); // INSERT

      await stakingModule.delegate("atone1del", "atonevalcons1v", {
        denom: "uatom",
        amount: "100",
      }, 600);

      expect(mockQuery.mock.calls[0][0]).toMatch(LATEST_ROW);
      expect(mockQuery.mock.calls[0][1]).toEqual(["atone1del", "atonevalcons1v"]);
      // New balance is built on the newest row (2500), not a genesis row
      expect(mockQuery.mock.calls[1][1]).toEqual(["atone1del", "atonevalcons1v", "(\"uatom\",\"2600\")", "2600", 600]);
    });

    it("redelegate reads the newest source balance", async () => {
      // the destination side is delegate(), covered separately
      vi.spyOn(stakingModule, "delegate").mockResolvedValue(undefined);
      mockQuery.mockResolvedValueOnce({
        rowCount: 0,
        rows: [],
      });

      await stakingModule.redelegate("atone1del", "atonevalcons1src", "atonevalcons1dst", {
        denom: "uatom",
        amount: "100",
      }, 600);

      expect(mockQuery.mock.calls[0][0]).toMatch(LATEST_ROW);
      expect(mockQuery.mock.calls[0][1]).toEqual(["atone1del", "atonevalcons1src"]);
    });
  });

  describe("cacheLatestValidatorStatuses", () => {
    beforeEach(async () => {
      mockQuery.mockReset();
      await stakingModule.init(mockPgIndexer as unknown as PgIndexer);
    });

    it("keys the cache by the active consensus address, which is what every reader looks up", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              validator_address: "atonevaloper1v",
              consensus_address: "atonevalcons1new",
              jailed: false,
              status: "BOND_STATUS_BONDED",
              height: 950,
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              voting_power: "1000",
              delegator_shares: "1000",
            },
          ],
        });

      await stakingModule.cacheLatestValidatorStatuses();

      expect(mockQuery.mock.calls[0][0]).toContain("JOIN validators v ON v.operator_address = s.validator_address AND v.is_active");
      expect(stakingModule.validatorCache.get("atonevalcons1new")).toEqual({
        status: "BOND_STATUS_BONDED",
        jailed: false,
        tokens: 1000n,
        delegator_shares: new BigNumber(1000),
      });
      expect(stakingModule.validatorCache.get("atonevaloper1v")).toBeUndefined();
    });
  });

  describe("genesis/array/app_state.staking.validators", () => {
    beforeEach(async () => {
      mockQuery.mockReset();
      await stakingModule.init(mockPgIndexer as unknown as PgIndexer);
    });

    it("derives the consensus address from consensus_pubkey.key as the SDK exports it", async () => {
      const handler = mockOn.mock.calls.find(
        (call: unknown[]) => call[0] === "genesis/array/app_state.staking.validators",
      )?.[1];
      mockQuery.mockResolvedValue(undefined);

      const operator = bech32.encode("cosmosvaloper", bech32.toWords(Buffer.alloc(20, 7)));
      const key = Buffer.alloc(32, 9).toString("base64");
      // Exported-state genesis shape: {"@type", key} directly under consensus_pubkey
      const validator = {
        operator_address: operator,
        consensus_pubkey: {
          "@type": "/cosmos.crypto.ed25519.PubKey",
          key,
        },
        jailed: false,
        status: 3,
        tokens: "1000",
        delegator_shares: "1000.000000000000000000",
        description: {
          moniker: "genesis-val",
        },
        commission: {
          commission_rates: {
            rate: "0.100000000000000000",
            max_rate: "0.200000000000000000",
            max_change_rate: "0.010000000000000000",
          },
        },
        min_self_delegation: "1",
      };

      expect(handler).toBeDefined();
      await handler!({
        value: [validator],
      });

      const expectedConsensus = Utils.chainAddressfromKeyhash(
        "cosmosvalcons", createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 40),
      );
      const saveValidator = mockQuery.mock.calls.find(call => call[0]?.name === "save-validator")?.[0];
      expect(saveValidator).toBeDefined();
      expect(saveValidator.values).toEqual([expectedConsensus, "/cosmos.crypto.ed25519.PubKey(" + Buffer.from(key, "base64").toString("hex") + ")", operator, null]);
    });
  });

  describe("fromLegacyDec", () => {
    it("rescales protobuf 18-decimal integers to plain decimals", () => {
      expect(fromLegacyDec("100000000000000000")).toBe("0.1");
      expect(fromLegacyDec("1000000000000000000")).toBe("1");
      expect(fromLegacyDec("10000000000000000")).toBe("0.01");
    });

    it("passes through empty values as undefined", () => {
      expect(fromLegacyDec("")).toBeUndefined();
      expect(fromLegacyDec(undefined)).toBeUndefined();
    });
  });

  describe("unbondingSeconds", () => {
    it("reads genesis JSON, proto JSON and duration strings", () => {
      expect(unbondingSeconds({
        unbonding_time: "1814400s",
      })).toBe(1814400);
      expect(unbondingSeconds({
        unbondingTime: {
          seconds: "1814400",
        },
      })).toBe(1814400);
      expect(unbondingSeconds({
        unbondingTime: "1814400s",
      })).toBe(1814400);
      expect(unbondingSeconds({
      })).toBe(0);
      expect(unbondingSeconds(undefined)).toBe(0);
    });
  });

  describe("undelegations", () => {
    const handlerFor = (name: string) => mockOn.mock.calls.find(
      (call: unknown[]) => call[0] === name,
    )?.[1];

    beforeEach(async () => {
      mockQuery.mockReset();
      await stakingModule.init(mockPgIndexer as unknown as PgIndexer);
      stakingModule.validatorAddressCache.set("cosmosvaloper1v", "cosmosvalcons1v");
    });

    it("MsgUndelegate reduces the newest staked balance and its shares", async () => {
      const handler = handlerFor("/cosmos.staking.v1beta1.MsgUndelegate");
      expect(handler).toBeDefined();
      vi.spyOn(stakingModule, "tokensToSharesAtHeight").mockResolvedValue(new BigNumber(100));
      mockQuery
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              to_json: {
                denom: "uatom",
                amount: "2500",
              },
              shares: "2500",
            },
          ],
        })
        .mockResolvedValueOnce(undefined);

      const tx = MsgUndelegate.encode(MsgUndelegate.fromPartial({
        delegatorAddress: "cosmos1del",
        validatorAddress: "cosmosvaloper1v",
        amount: {
          denom: "uatom",
          amount: "100",
        },
      })).finish();
      await handler!({
        value: {
          tx,
          events: [],
        },
        height: 600,
      });

      expect(mockQuery.mock.calls[0][1]).toEqual(["cosmos1del", "cosmosvalcons1v"]);
      expect(mockQuery.mock.calls[1][1]).toEqual(["cosmos1del", "cosmosvalcons1v", "(\"uatom\",\"2400\")", "2400", 600]);
    });

    it("MsgUndelegate floors the balance at zero", async () => {
      const handler = handlerFor("/cosmos.staking.v1beta1.MsgUndelegate");
      vi.spyOn(stakingModule, "tokensToSharesAtHeight").mockRejectedValue(new Error("Validator does not exist"));
      mockQuery
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              to_json: {
                denom: "uatom",
                amount: "50",
              },
              shares: "50",
            },
          ],
        })
        .mockResolvedValueOnce(undefined);

      const tx = MsgUndelegate.encode(MsgUndelegate.fromPartial({
        delegatorAddress: "cosmos1del",
        validatorAddress: "cosmosvaloper1v",
        amount: {
          denom: "uatom",
          amount: "80",
        },
      })).finish();
      await handler!({
        value: {
          tx,
          events: [],
        },
        height: 600,
      });

      expect(mockQuery.mock.calls[1][1]).toEqual(["cosmos1del", "cosmosvalcons1v", "(\"uatom\",\"0\")", "0", 600]);
    });

    it("MsgCancelUnbondingDelegation returns the tokens to the delegation", async () => {
      const handler = handlerFor("/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation");
      expect(handler).toBeDefined();
      const delegate = vi.spyOn(stakingModule, "delegate").mockResolvedValue(undefined);

      const tx = MsgCancelUnbondingDelegation.encode(MsgCancelUnbondingDelegation.fromPartial({
        delegatorAddress: "cosmos1del",
        validatorAddress: "cosmosvaloper1v",
        amount: {
          denom: "uatom",
          amount: "70",
        },
        creationHeight: 590n,
      })).finish();
      await handler!({
        value: {
          tx,
          events: [],
        },
        height: 600,
      });

      expect(delegate).toHaveBeenCalledWith("cosmos1del", "cosmosvalcons1v", {
        denom: "uatom",
        amount: "70",
      }, 600);
    });
  });

  describe("delegate without a cached validator", () => {
    beforeEach(async () => {
      mockQuery.mockReset();
      await stakingModule.init(mockPgIndexer as unknown as PgIndexer);
    });

    it("falls back to the recorded voting power instead of dropping the delegation", async () => {
      const atHeight = vi.spyOn(stakingModule, "tokensToSharesAtHeight").mockResolvedValue(new BigNumber(90));
      mockQuery
        .mockResolvedValueOnce({
          rowCount: 0,
          rows: [],
        })
        .mockResolvedValueOnce(undefined);

      await stakingModule.delegate("cosmos1del", "cosmosvalcons1uncached", {
        denom: "uatom",
        amount: "100",
      }, 600);

      expect(atHeight).toHaveBeenCalledWith(100n, "cosmosvalcons1uncached", 600);
      expect(mockQuery.mock.calls[1][1]).toEqual(["cosmos1del", "cosmosvalcons1uncached", "(\"uatom\",\"100\")", "90", 600]);
    });

    it("assumes a 1:1 rate for a validator with no recorded power at all", async () => {
      vi.spyOn(stakingModule, "tokensToSharesAtHeight").mockRejectedValue(new Error("Validator does not exist"));
      mockQuery
        .mockResolvedValueOnce({
          rowCount: 0,
          rows: [],
        })
        .mockResolvedValueOnce(undefined);

      await stakingModule.delegate("cosmos1del", "cosmosvalcons1new", {
        denom: "uatom",
        amount: "100",
      }, 600);

      expect(mockQuery.mock.calls[1][1]).toEqual(["cosmos1del", "cosmosvalcons1new", "(\"uatom\",\"100\")", "100", 600]);
    });
  });

  describe("MsgCreateValidator", () => {
    beforeEach(async () => {
      mockQuery.mockReset();
      await stakingModule.init(mockPgIndexer as unknown as PgIndexer);
    });

    it("upserts validator rows, retires other keys, and stores commission on the decimal scale", async () => {
      const handler = mockOn.mock.calls.find(
        (call: unknown[]) => call[0] === "/cosmos.staking.v1beta1.MsgCreateValidator",
      )?.[1];
      expect(handler).toBeDefined();
      mockQuery.mockResolvedValue(undefined);

      const operator = bech32.encode("cosmosvaloper", bech32.toWords(Buffer.alloc(20, 3)));
      const delegator = bech32.encode("cosmos", bech32.toWords(Buffer.alloc(20, 3)));
      const keyBytes = Buffer.alloc(32, 5);
      const pubkey = Any.fromPartial({
        typeUrl: "/cosmos.crypto.ed25519.PubKey",
        value: EdPubKey.encode(EdPubKey.fromPartial({
          key: keyBytes,
        })).finish(),
      });
      const tx = MsgCreateValidator.encode(MsgCreateValidator.fromPartial({
        validatorAddress: operator,
        delegatorAddress: delegator,
        pubkey,
        description: {
          moniker: "recreated",
        },
        commission: {
          rate: "100000000000000000",
          maxRate: "200000000000000000",
          maxChangeRate: "10000000000000000",
        },
        minSelfDelegation: "1",
        value: {
          denom: "uatom",
          amount: "1000",
        },
      })).finish();

      await handler!({
        value: {
          tx,
          events: [],
        },
        height: 700,
      });

      const expectedConsensus = Utils.chainAddressfromKeyhash(
        "cosmosvalcons", createHash("sha256").update(keyBytes).digest("hex").slice(0, 40),
      );
      const byName = (name: string) => mockQuery.mock.calls.find(call => call[0]?.name === name)?.[0];
      expect(byName("save-validator-info").text).toContain("ON CONFLICT (operator_address) DO UPDATE");
      expect(byName("save-validator-info").values).toEqual([operator, delegator, "0.01", "0.2", 700]);
      expect(byName("deactivate-other-validator-keys").values).toEqual([operator, expectedConsensus]);
      expect(byName("save-validator").text).toContain("ON CONFLICT (consensus_address) DO UPDATE");
      expect(byName("save-validator").values[0]).toBe(expectedConsensus);
      expect(byName("save-validator-commission").values).toEqual([operator, "0.1", "1", 700]);
    });
  });

  describe("getStakingParams", () => {
    beforeEach(async () => {
      mockQuery.mockReset();
      await stakingModule.init(mockPgIndexer as unknown as PgIndexer);
    });

    it("reads the chain once and stores a baseline row when nothing is stored", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rowCount: 0,
          rows: [],
        })
        .mockResolvedValueOnce(undefined);
      mockPgIndexer.indexer.callABCI.mockResolvedValue(QueryParamsResponse.encode(QueryParamsResponse.fromPartial({
        params: {
          unbondingTime: {
            seconds: 1814400n,
            nanos: 0,
          },
          maxValidators: 100,
          maxEntries: 7,
          historicalEntries: 10000,
          bondDenom: "uatom",
          minCommissionRate: "0",
        },
      })).finish());

      const params = await stakingModule.getStakingParams(600n);

      expect(unbondingSeconds(params)).toBe(1814400);
      expect(mockPgIndexer.indexer.callABCI).toHaveBeenCalledWith("/cosmos.staking.v1beta1.Query/Params", expect.any(Uint8Array), 600);
      expect(mockQuery.mock.calls[1][0]).toContain("INSERT INTO staking_params");
      expect(mockQuery.mock.calls[1][1][1]).toBeNull();
    });

    it("converts the unbonding period to a wall-clock window in seconds", async () => {
      const blockTime = new Date("2026-01-22T00:00:00Z");
      mockQuery
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              timestamp: blockTime,
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              height: 100,
            },
          ],
        });

      await stakingModule.getUnbondingHeight(600n, 1814400);

      const cutoff = mockQuery.mock.calls[1][1][0] as Date;
      expect(blockTime.getTime() - cutoff.getTime()).toBe(21 * 24 * 3600 * 1000);
    });
  });

  describe("checkAndSaveValidators", () => {
    beforeEach(async () => {
      mockQuery.mockReset();
      await stakingModule.init(mockPgIndexer as unknown as PgIndexer);
    });

    it("skips a validator whose consensus address is not known yet", async () => {
      mockQuery.mockResolvedValue({
        rowCount: 0,
        rows: [],
      });

      await stakingModule.checkAndSaveValidators([
        Validator.fromPartial({
          operatorAddress: "cosmosvaloper1brandnew",
          tokens: "10",
          delegatorShares: "10000000000000000000",
        }),
      ], 500);

      const inserts = mockQuery.mock.calls.filter(call => typeof call[0] === "object" && call[0]?.name?.startsWith("save-validator"));
      expect(inserts.length).toBe(0);
    });

    it("lets a database error fail the block instead of swallowing it", async () => {
      stakingModule.validatorAddressCache.set("cosmosvaloper1v", "cosmosvalcons1v");
      mockQuery.mockRejectedValue(new Error("value out of range"));

      await expect(stakingModule.checkAndSaveValidators([
        Validator.fromPartial({
          operatorAddress: "cosmosvaloper1v",
          tokens: "10",
          delegatorShares: "10000000000000000000",
        }),
      ], 500)).rejects.toThrow("value out of range");
    });
  });

  describe("updateDelegatorDelegations", () => {
    beforeEach(async () => {
      mockQuery.mockReset();
      mockQuery.mockResolvedValue(undefined);
      await stakingModule.init(mockPgIndexer as unknown as PgIndexer);
      stakingModule.validatorAddressCache.set("cosmosvaloper1a", "cosmosvalcons1a");
      stakingModule.validatorAddressCache.set("cosmosvaloper1b", "cosmosvalcons1b");
    });

    it("follows pagination across pages of delegations", async () => {
      const page = (validators: string[], nextKey?: Uint8Array) => QueryDelegatorDelegationsResponse.encode(QueryDelegatorDelegationsResponse.fromPartial({
        delegationResponses: validators.map(validatorAddress => ({
          delegation: {
            delegatorAddress: "cosmos1del",
            validatorAddress,
            shares: "1000000000000000000",
          },
          balance: {
            denom: "uatom",
            amount: "1",
          },
        })),
        pagination: nextKey
          ? {
            nextKey,
            total: 0n,
          }
          : undefined,
      })).finish();
      mockPgIndexer.indexer.callABCI.mockImplementation(async (_path: string, data: Uint8Array) => {
        const key = QueryDelegatorDelegationsRequest.decode(data).pagination?.key ?? new Uint8Array();
        return key.length === 0 ? page(["cosmosvaloper1a"], new Uint8Array([7])) : page(["cosmosvaloper1b"]);
      });

      await stakingModule.updateDelegatorDelegations("cosmos1del", 900n);

      expect(mockPgIndexer.indexer.callABCI).toHaveBeenCalledTimes(2);
      const inserts = mockQuery.mock.calls.filter(call => typeof call[0] === "string" && call[0].startsWith("INSERT INTO staked_balances"));
      expect(inserts.map(call => call[1][1])).toEqual(["cosmosvalcons1a", "cosmosvalcons1b"]);
    });
  });

  describe("consensusKeyHash", () => {
    it("hashes ed25519 keys with sha256[:20] and secp256k1 keys with ripemd160(sha256)", () => {
      const key = Buffer.alloc(32, 7);
      const sha = createHash("sha256").update(key).digest();
      expect(consensusKeyHash("/cosmos.crypto.ed25519.PubKey", key)).toBe(sha.toString("hex").slice(0, 40));
      expect(consensusKeyHash("/cosmos.crypto.secp256k1.PubKey", key)).toBe(createHash("ripemd160").update(sha).digest("hex"));
      expect(consensusKeyHash("/cosmos.crypto.secp256k1.PubKey", key)).not.toBe(consensusKeyHash("/cosmos.crypto.ed25519.PubKey", key));
    });
  });

  describe("editedField", () => {
    it("keeps the stored value only for the SDK sentinel or an absent field", () => {
      expect(editedField("[do-not-modify]", "old")).toBe("old");
      expect(editedField(undefined, "old")).toBe("old");
      expect(editedField("new", "old")).toBe("new");
      expect(editedField("", "old")).toBe("");
    });
  });
});
