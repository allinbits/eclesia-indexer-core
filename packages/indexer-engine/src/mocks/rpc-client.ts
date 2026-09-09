/**
 * Mock RPC client for benchmarking and testing
 * Generates synthetic blockchain data without requiring an actual RPC node
 */
import {
  createHash,
} from "node:crypto";

import {
  fromBase64, fromHex, toBech32,
} from "@cosmjs/encoding";
import {
  AbciQueryParams,
  AbciQueryResponse,
  BlockResponse,
  BlockResultsResponse,
  CometClient,
  fromRfc3339WithNanoseconds,
  StatusResponse,
  TxData,
} from "@cosmjs/tendermint-rpc";
import {
  BlockResultsResponse as BlockResultsResponse38, Event as Event38,
} from "@cosmjs/tendermint-rpc/build/comet38/responses.js";
import {
  ModuleAccount,
} from "cosmjs-types/cosmos/auth/v1beta1/auth.js";
import {
  QueryModuleAccountsResponse,
} from "cosmjs-types/cosmos/auth/v1beta1/query.js";
import {
  QueryAllBalancesResponse,
} from "cosmjs-types/cosmos/bank/v1beta1/query.js";
import {
  QueryDelegatorDelegationsResponse,
  QueryParamsResponse as QueryStakingParamsResponse,
  QueryPoolResponse,
  QueryValidatorDelegationsResponse,
  QueryValidatorsRequest,
  QueryValidatorsResponse,
} from "cosmjs-types/cosmos/staking/v1beta1/query.js";
import {
  Validator,
} from "cosmjs-types/cosmos/staking/v1beta1/staking.js";
import {
  Tx,
} from "cosmjs-types/cosmos/tx/v1beta1/tx.js";

/** Configuration for mock data generation */
export interface MockRpcConfig {
  /** Chain ID for generated blocks */
  chainId: string
  /** Number of transactions per block */
  txPerBlock: number
  /** Starting block height */
  startHeight: number
  /** Latest block height available */
  endHeight: number
  /** Which CometBFT response shape to produce (default: 0.37) */
  cometVersion?: "0.37" | "0.38"
  /** Size of the synthetic validator set answered by the Validators ABCI query (default: 3) */
  validatorCount?: number
}

/** Deterministic bech32 address from a small integer, for synthetic accounts and validators */
export function syntheticAddress(prefix: string, seed: number): string {
  const bytes = new Uint8Array(20);
  bytes[0] = seed & 0xff;
  bytes[1] = (seed >> 8) & 0xff;
  bytes[19] = 0x01;
  return toBech32(prefix, bytes);
}

/** Module accounts a chain always has, with deterministic addresses (computed on first use) */
export function mockModuleAccounts(): Record<string, string> {
  return {
    fee_collector: syntheticAddress("cosmos", 1001),
    distribution: syntheticAddress("cosmos", 1002),
  };
}

/**
 * Generates a synthetic transaction with realistic structure
 */
function generateMockTx(height: number, txIndex: number): Uint8Array {
  const tx: Tx = {
    body: {
      messages: [
        {
          typeUrl: "/cosmos.bank.v1beta1.MsgSend",
          value: new Uint8Array([10, 45, 99, 111, 115, 109, 111, 115, 49, 18, 45, 99, 111, 115, 109, 111, 115, 50]),
        },
      ],
      memo: `Mock tx ${height}-${txIndex}`,
      timeoutHeight: BigInt(height + 100),
      extensionOptions: [],
      nonCriticalExtensionOptions: [],
    },
    authInfo: {
      signerInfos: [
        {
          publicKey: {
            typeUrl: "/cosmos.crypto.secp256k1.PubKey",
            value: new Uint8Array(33),
          },
          modeInfo: {
            single: {
              mode: 1,
            },
          },
          sequence: BigInt(txIndex),
        },
      ],
      fee: {
        amount: [
          {
            denom: "uatom",
            amount: "5000",
          },
        ],
        gasLimit: BigInt(200000),
        payer: "",
        granter: "",
      },
      tip: undefined,
    },
    signatures: [new Uint8Array(64)],
  };

  return Tx.encode(tx).finish();
}

export class MockRpcClient {
  private chainId: string;
  private startHeight: number;
  private endHeight: number;
  private txPerBlock: number;
  private cometVersion: "0.37" | "0.38";
  private validatorCount: number;

  constructor({
    chainId,
    startHeight,
    endHeight,
    txPerBlock,
    cometVersion,
    validatorCount,
  }: MockRpcConfig) {
    this.chainId = chainId;
    this.startHeight = startHeight;
    this.endHeight = endHeight;
    this.txPerBlock = txPerBlock;
    this.cometVersion = cometVersion ?? "0.37";
    this.validatorCount = validatorCount ?? 3;
  }

  /** The synthetic validator set, identical at every height */
  validators(): Validator[] {
    const set: Validator[] = [];
    for (let i = 0; i < this.validatorCount; i++) {
      set.push(Validator.fromPartial({
        operatorAddress: syntheticAddress("cosmosvaloper", i + 1),
        jailed: false,
        status: 3,
        tokens: String(1000000 * (i + 1)),
        delegatorShares: String(1000000 * (i + 1)) + "000000000000000000",
        description: {
          moniker: "mock-validator-" + (i + 1),
        },
        commission: {
          commissionRates: {
            rate: "100000000000000000",
            maxRate: "200000000000000000",
            maxChangeRate: "10000000000000000",
          },
        },
        minSelfDelegation: "1",
      }));
    }
    return set;
  }

  /**
   * Answers the ABCI queries the engine and the core modules issue. Unknown paths get a
   * non-zero code, as a real node would answer for a query it does not serve.
   */
  async abciQuery(params: AbciQueryParams): Promise<AbciQueryResponse> {
    const reply = (value: Uint8Array): AbciQueryResponse => ({
      key: new Uint8Array(),
      value,
      height: params.height,
      index: 0,
      code: 0,
      codespace: "",
      log: "",
      info: "",
    });
    switch (params.path) {
      case "/cosmos.staking.v1beta1.Query/Validators": {
        const request = QueryValidatorsRequest.decode(params.data);
        const all = this.validators();
        const limit = Number(request.pagination?.limit ?? 100n) || 100;
        const key = request.pagination?.key;
        const offset = key && key.length > 0 ? key[0] : 0;
        const page = all.slice(offset, offset + limit);
        const next = offset + limit < all.length ? new Uint8Array([offset + limit]) : new Uint8Array();
        return reply(QueryValidatorsResponse.encode(QueryValidatorsResponse.fromPartial({
          validators: page,
          pagination: {
            nextKey: next,
            total: BigInt(all.length),
          },
        })).finish());
      }
      case "/cosmos.auth.v1beta1.Query/ModuleAccounts":
        return reply(QueryModuleAccountsResponse.encode(QueryModuleAccountsResponse.fromPartial({
          accounts: Object.entries(mockModuleAccounts()).map(([name, address]) => ({
            typeUrl: "/cosmos.auth.v1beta1.ModuleAccount",
            value: ModuleAccount.encode(ModuleAccount.fromPartial({
              baseAccount: {
                address,
              },
              name,
            })).finish(),
          })),
        })).finish());
      case "/cosmos.bank.v1beta1.Query/AllBalances":
        return reply(QueryAllBalancesResponse.encode(QueryAllBalancesResponse.fromPartial({
          balances: [
            {
              denom: "uatom",
              amount: "1000000",
            },
          ],
        })).finish());
      case "/cosmos.staking.v1beta1.Query/Pool":
        return reply(QueryPoolResponse.encode(QueryPoolResponse.fromPartial({
          pool: {
            bondedTokens: String(this.validators().reduce((sum, v) => sum + Number(v.tokens), 0)),
            notBondedTokens: "0",
          },
        })).finish());
      case "/cosmos.staking.v1beta1.Query/Params":
        return reply(QueryStakingParamsResponse.encode(QueryStakingParamsResponse.fromPartial({
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
      case "/cosmos.staking.v1beta1.Query/DelegatorDelegations":
        return reply(QueryDelegatorDelegationsResponse.encode(QueryDelegatorDelegationsResponse.fromPartial({
        })).finish());
      case "/cosmos.staking.v1beta1.Query/ValidatorDelegations":
        return reply(QueryValidatorDelegationsResponse.encode(QueryValidatorDelegationsResponse.fromPartial({
        })).finish());
      default:
        return {
          ...reply(new Uint8Array()),
          code: 6,
          log: "unknown request: " + params.path,
        };
    }
  }

  async block(height: number): Promise<BlockResponse> {
    const txs: Uint8Array[] = [];
    for (let i = 0; i < this.txPerBlock; i++) {
      txs.push(generateMockTx(height, i));
    }
    // Deterministic, unique per height: the blocks table has a unique constraint on the hash
    const hashOf = (h: number) => new Uint8Array(createHash("sha256").update(this.chainId + ":" + h).digest());
    return {
      block: {
        header: {
          height: height,
          version: {
            block: 11,
            app: 0,
          },
          time: fromRfc3339WithNanoseconds(new Date().toISOString()),
          chainId: this.chainId,
          lastBlockId: null,
          lastCommitHash: new Uint8Array(),
          dataHash: new Uint8Array(),
          validatorsHash: new Uint8Array(),
          nextValidatorsHash: new Uint8Array(),
          consensusHash: new Uint8Array(),
          appHash: new Uint8Array(),
          lastResultsHash: new Uint8Array(),
          evidenceHash: new Uint8Array(),
          proposerAddress: new Uint8Array(),
        },
        txs: txs,
        evidence: [],
        lastCommit: {
          height: height - 1,
          round: 0,
          blockId: {
            hash: new Uint8Array(),
            parts: {
              total: 0,
              hash: new Uint8Array(),
            },
          },
          signatures: [
            {
              blockIdFlag: 2,
              validatorAddress: fromHex("D68EEC0D2E8248F1EC64CDB585EDB61ECA432BD8"),
              timestamp: fromRfc3339WithNanoseconds(new Date().toISOString()),
              signature: fromBase64("Z6d2P35dI6qBzfPdyIZvmZi7Imo2FmQ5kNSnpVb2UvCj0aSjRCtS59BauJFB6FDHPluOUYoz0rJ4jiOnNXh9AA=="),
            },
          ],
        },
      },
      blockId: {
        hash: hashOf(height),
        parts: {
          total: 0,
          hash: new Uint8Array(),
        },
      },
    };
  }

  async status(): Promise<StatusResponse> {
    return {
      nodeInfo: {
        protocolVersion: {
          p2p: 8,
          block: 11,
          app: 0,
        },
        id: fromHex("d2982128df6a29e700980f325b0444e301c604d7"),
        listenAddr: "tcp://0.0.0.0:26656",
        network: this.chainId,
        version: this.cometVersion === "0.38" ? "0.38.17" : "0.37.15",
        channels: "40202122233038606100",
        moniker: "node",
        other: new Map([["txIndex", "on"], ["rpcAddress", "tcp://0.0.0.0:26657"]]),
      },
      syncInfo: {
        latestBlockHash: fromHex("3F3F7A6F11FA91856BE440F8C78262307CAEAB122720D61CB14B118EF89892B5"),
        latestAppHash: fromHex("FF91D618633BDD5395763F34805E6DACF6BBFB642A2E787677BF28B39427F289"),
        latestBlockHeight: this.endHeight,
        latestBlockTime: fromRfc3339WithNanoseconds("2025-11-06T12:58:21.271608775Z"),
        earliestBlockHash: fromHex("54473B6F28CAA85F5664F7CA3F2EEE49CD9857BDE41E0BF604B1A1DE93CBFEFF"),
        earliestAppHash: fromHex("24DFB6C312A7FD4B753444F5CD5FAC4D239BAEC09B6A79BB3D04B21B0BC1FC53"),
        earliestBlockHeight: 1,
        earliestBlockTime: fromRfc3339WithNanoseconds("2025-05-28T07:58:54.905470438Z"),
        catchingUp: false,
      },
      validatorInfo: {
        address: fromHex("1C7CE0213D96CD5578249740DC31A9D8E4D7A226"),
        pubkey: {
          algorithm: "ed25519",
          data: fromBase64("+KoTmCU6lo7NCtsfPCYpdNf0fs3aScZ8CtdgHTR/oGs="),
        },
        votingPower: 0n,
      },
    };
  }

  subscribeNewBlock() {
    return {
      addListener: (..._args: unknown[]) => {},
      removeListener: (..._args: unknown[]) => {},
    } as ReturnType<CometClient["subscribeNewBlock"]>;
  }

  async disconnect(): Promise<void> {
    // No-op for mock
  }

  async blockResults(height: number): Promise<BlockResultsResponse | BlockResultsResponse38> {
    const attribute = (key: string, value: string) => ({
      key,
      value,
    });
    const feeCollector = mockModuleAccounts().fee_collector;
    // Events a real bank module emits for the transfer each mock tx performs
    const transferEvents = (msgIndex: number): Event38[] => [
      {
        type: "message",
        attributes: [attribute("action", "/cosmos.bank.v1beta1.MsgSend"), attribute("msg_index", String(msgIndex))],
      },
      {
        type: "coin_spent",
        attributes: [attribute("spender", syntheticAddress("cosmos", 1)), attribute("amount", "10uatom"), attribute("msg_index", String(msgIndex))],
      },
      {
        type: "coin_received",
        attributes: [attribute("receiver", syntheticAddress("cosmos", 2)), attribute("amount", "10uatom"), attribute("msg_index", String(msgIndex))],
      },
    ];
    const results: TxData[] = [];
    for (let i = 0; i < this.txPerBlock; i++) {
      results.push({
        code: 0,
        data: Buffer.from("success"),
        // CometBFT 0.37 nodes return the structured log; 0.38 nodes return an empty log and
        // events tagged with msg_index instead
        log: this.cometVersion === "0.38"
          ? ""
          : JSON.stringify([
            {
              msg_index: 0,
              events: transferEvents(0),
            },
          ]),
        gasWanted: BigInt(200000),
        gasUsed: BigInt(150000),
        // The 0.37 and 0.38 event types are structurally identical
        events: transferEvents(0) as unknown as TxData["events"],
        codespace: "",
      });
    }
    // Block-level flows: the fee collector receives the mint at the start of the block
    const beginBlockEvents: Event38[] = [
      {
        type: "coin_received",
        attributes: [attribute("receiver", feeCollector), attribute("amount", "50uatom")],
      },
    ];
    const endBlockEvents: Event38[] = [
      {
        type: "coin_spent",
        attributes: [attribute("spender", feeCollector), attribute("amount", "5uatom")],
      },
    ];
    if (this.cometVersion === "0.38") {
      // Cosmos SDK 0.50+ delivers both phases in one list, tagged with mode=BeginBlock / EndBlock
      const tagged = (events: Event38[], mode: string) => events.map(event => ({
        type: event.type,
        attributes: [...event.attributes, attribute("mode", mode)],
      }));
      return {
        height,
        results,
        finalizeBlockEvents: [...tagged(beginBlockEvents, "BeginBlock"), ...tagged(endBlockEvents, "EndBlock")],
        validatorUpdates: [],
        consensusUpdates: undefined,
      } as unknown as BlockResultsResponse38;
    }
    return {
      height,
      results,
      beginBlockEvents,
      endBlockEvents,
      validatorUpdates: [],
      consensusUpdates: undefined,
    } as unknown as BlockResultsResponse;
  }

  async connect(): Promise<void> {
  }
}

/**
 * Factory function to create a mock RPC client
 */
export function createMockRpcClient(config: MockRpcConfig): CometClient {
  return new MockRpcClient(config) as unknown as CometClient;
}
