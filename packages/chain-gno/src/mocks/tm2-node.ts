/**
 * A synthetic Tendermint2 (gno.land) node for tests and benchmarks: deterministic blocks whose
 * transactions cycle through every message type the adapter decodes, with realistic execution
 * results and VM events, without a network.
 */
import {
  createHash,
} from "node:crypto";

import {
  Utils,
} from "@eclesia/indexer-engine";
import {
  gno,
} from "@gnolang/gno-types";
import {
  AbciQueryParams, AbciQueryResponse, BlockResponse, BlockResultsResponse, Event, fromRfc3339WithNanoseconds, StatusResponse, Tm2Client, TxResult, Validator, ValidatorsParams, ValidatorsResponse,
} from "@gnolang/tm2-rpc";

import {
  encodeTx, MSG_ADD_PACKAGE, MSG_CALL, MSG_RUN, MSG_SEND,
} from "../messages.js";

/** Amino type of the events realms emit through std.Emit */
export const GNO_EVENT_TYPE = "/tm.gnoEvent";

/** Amino type of the storage deposit event the VM emits when a package grows its state */
export const STORAGE_DEPOSIT_EVENT_TYPE = "/tm.storageDepositEvent";

/** Configuration for mock data generation */
export interface MockTm2Config {
  /** Chain ID for generated blocks */
  chainId: string
  /** Number of transactions per block */
  txPerBlock: number
  /** Starting block height */
  startHeight: number
  /** Latest block height available */
  endHeight: number
  /** Size of the synthetic validator set (default: 3) */
  validatorCount?: number
  /** Every n-th transaction of a block fails (default: none fail) */
  failEvery?: number
}

/** Message type URLs a block's transactions cycle through, by transaction index */
export const MOCK_MESSAGE_CYCLE = [MSG_SEND, MSG_CALL, MSG_ADD_PACKAGE, MSG_RUN] as const;

/** Realm the synthetic calls and deployments target */
export const MOCK_REALM = "gno.land/r/demo/counter";

/** Deterministic bech32 `g1...` address from a small integer, for synthetic accounts and validators */
export function syntheticAddress(seed: number): string {
  const bytes = new Uint8Array(20);
  bytes[0] = seed & 0xff;
  bytes[1] = (seed >> 8) & 0xff;
  bytes[19] = 0x01;
  return Utils.chainAddressfromKeyhash("g", Buffer.from(bytes).toString("hex"));
}

/** Raw 20-byte address of a synthetic validator */
function validatorAddressBytes(index: number): Uint8Array {
  const bytes = new Uint8Array(20);
  bytes[0] = 0xa0 + index;
  bytes[19] = 0x02;
  return bytes;
}

/** Builds the message a synthetic transaction carries, by its position in the block */
export function mockMessage(height: number, txIndex: number): {
  typeUrl: string
  value: Uint8Array
} {
  const typeUrl = MOCK_MESSAGE_CYCLE[txIndex % MOCK_MESSAGE_CYCLE.length];
  switch (typeUrl) {
    case MSG_SEND:
      return {
        typeUrl,
        value: gno.gno.bank.bank.MsgSend.encode(gno.gno.bank.bank.MsgSend.fromPartial({
          fromAddress: syntheticAddress(1),
          toAddress: syntheticAddress(2),
          amount: "10ugnot",
        })).finish(),
      };
    case MSG_CALL:
      return {
        typeUrl,
        value: gno.gno.vm.vm.MsgCall.encode(gno.gno.vm.vm.MsgCall.fromPartial({
          caller: syntheticAddress(1),
          send: "",
          maxDeposit: "",
          pkgPath: MOCK_REALM,
          func: "Increment",
          args: [String(height)],
        })).finish(),
      };
    case MSG_ADD_PACKAGE:
      return {
        typeUrl,
        value: gno.gno.vm.vm.MsgAddPackage.encode(gno.gno.vm.vm.MsgAddPackage.fromPartial({
          creator: syntheticAddress(3),
          package: {
            name: "counter",
            path: MOCK_REALM + "_" + height,
            files: [
              {
                name: "counter.gno",
                body: "package counter\n\nvar count int\n\nfunc Increment() { count++ }\n",
              },
            ],
          },
          send: "",
          maxDeposit: "1000000ugnot",
        })).finish(),
      };
    default:
      return {
        typeUrl: MSG_RUN,
        value: gno.gno.vm.vm.MsgRun.encode(gno.gno.vm.vm.MsgRun.fromPartial({
          caller: syntheticAddress(4),
          send: "",
          maxDeposit: "",
          package: {
            name: "main",
            path: "",
            files: [
              {
                name: "main.gno",
                body: "package main\n\nfunc main() { println(\"hi\") }\n",
              },
            ],
          },
        })).finish(),
      };
  }
}

/** Encodes a synthetic transaction with one message */
export function mockTx(height: number, txIndex: number): Uint8Array {
  return encodeTx(gno.tm2.tx.tx.Tx.fromPartial({
    messages: [mockMessage(height, txIndex)],
    fee: {
      gasWanted: 200000n,
      gasFee: "1000000ugnot",
    },
    signatures: [
      {
        signature: new Uint8Array(64),
      },
    ],
    memo: "mock tx " + height + "-" + txIndex,
  }));
}

/** A std.Emit event as a realm would produce it */
export function gnoEvent(type: string, pkgPath: string, attrs: Record<string, string>): Event {
  return {
    "@type": GNO_EVENT_TYPE,
    type,
    pkg_path: pkgPath,
    attrs: Object.entries(attrs).map(([key, value]) => ({
      key,
      value,
    })),
  };
}

export class MockTm2Client {
  private chainId: string;
  private startHeight: number;
  private endHeight: number;
  private txPerBlock: number;
  private validatorCount: number;
  private failEvery: number | undefined;

  /** Every ABCI query path asked, for tests */
  public queries: string[] = [];

  /** Whether disconnect() was called */
  public disconnected = false;

  constructor({
    chainId,
    startHeight,
    endHeight,
    txPerBlock,
    validatorCount,
    failEvery,
  }: MockTm2Config) {
    this.chainId = chainId;
    this.startHeight = startHeight;
    this.endHeight = endHeight;
    this.txPerBlock = txPerBlock;
    this.validatorCount = validatorCount ?? 3;
    this.failEvery = failEvery;
  }

  /** The synthetic validator set, identical at every height */
  validatorSet(): Validator[] {
    const set: Validator[] = [];
    for (let i = 0; i < this.validatorCount; i++) {
      set.push({
        address: validatorAddressBytes(i),
        pubkey: {
          algorithm: "ed25519",
          data: new Uint8Array(32).fill(i + 1),
        } as unknown as Validator["pubkey"],
        votingPower: BigInt(10 * (i + 1)),
        proposerPriority: 0n,
      });
    }
    return set;
  }

  /** Bech32 address of the validator proposing a height (round robin) */
  proposerOf(height: number): string {
    const index = height % this.validatorCount;
    return Utils.chainAddressfromKeyhash("g", Buffer.from(validatorAddressBytes(index)).toString("hex"));
  }

  async status(): Promise<StatusResponse> {
    return {
      nodeInfo: {
        listenAddr: "tcp://0.0.0.0:26656",
        network: this.chainId,
        version: "1.0.0",
        software: "gno",
        channels: [],
        moniker: "mock",
        other: new Map(),
        versionSet: [],
      },
      syncInfo: {
        latestBlockHash: new Uint8Array(32),
        latestAppHash: new Uint8Array(32),
        latestBlockHeight: this.endHeight,
        latestBlockTime: new Date(),
        catchingUp: false,
      },
      validatorInfo: this.validatorSet()[0],
    } as unknown as StatusResponse;
  }

  async block(height: number): Promise<BlockResponse> {
    const txs: Uint8Array[] = [];
    for (let i = 0; i < this.txPerBlock; i++) {
      txs.push(mockTx(height, i));
    }
    const hashOf = (label: string) => new Uint8Array(createHash("sha256").update(this.chainId + ":" + label).digest());
    const time = fromRfc3339WithNanoseconds(new Date(1700000000000 + height * 1000).toISOString());
    const header = {
      version: "v1.0.0-rc.0",
      chainId: this.chainId,
      height,
      time,
      numTxs: BigInt(txs.length),
      totalTxs: BigInt(txs.length * (height - this.startHeight + 1)),
      appVersion: "",
      lastBlockId: height > 1
        ? {
          hash: hashOf("block:" + (height - 1)),
          parts: {
            total: 1n,
            hash: new Uint8Array(32),
          },
        }
        : null,
      lastCommitHash: new Uint8Array(32),
      dataHash: new Uint8Array(32),
      validatorsHash: new Uint8Array(32),
      nextValidatorsHash: new Uint8Array(32),
      consensusHash: new Uint8Array(32),
      appHash: new Uint8Array(32),
      lastResultsHash: new Uint8Array(32),
      proposerAddress: this.proposerOf(height),
    };
    const blockId = {
      hash: hashOf("block:" + height),
      parts: {
        total: 1n,
        hash: new Uint8Array(32),
      },
    };
    return {
      blockMeta: {
        blockId,
        header,
      },
      block: {
        header,
        lastCommit: height > 1
          ? {
            blockId: {
              hash: hashOf("block:" + (height - 1)),
              parts: {
                total: 1n,
                hash: new Uint8Array(32),
              },
            },
            precommits: this.validatorSet().map((validator, index) => ({
              type: 2,
              validatorAddress: Utils.chainAddressfromKeyhash("g", Buffer.from(validator.address).toString("hex")),
              validatorIndex: index,
              height: height - 1,
              round: 0,
              timestamp: time,
              blockId,
              signature: new Uint8Array(64),
            })),
          }
          : null,
        txs,
        evidence: [],
      },
    } as unknown as BlockResponse;
  }

  async blockResults(height: number): Promise<BlockResultsResponse> {
    const deliverTx: TxResult[] = [];
    for (let i = 0; i < this.txPerBlock; i++) {
      const failed = this.failEvery !== undefined && this.failEvery > 0 && (i + 1) % this.failEvery === 0;
      const typeUrl = MOCK_MESSAGE_CYCLE[i % MOCK_MESSAGE_CYCLE.length];
      const events: Event[] = [];
      if (!failed && typeUrl === MSG_CALL) {
        events.push(gnoEvent("Incremented", MOCK_REALM, {
          count: String(height),
        }));
      }
      if (!failed && typeUrl === MSG_ADD_PACKAGE) {
        events.push({
          "@type": STORAGE_DEPOSIT_EVENT_TYPE,
          type: "StorageDeposit",
          pkg_path: MOCK_REALM + "_" + height,
          attrs: [],
          bytes_delta: 1024,
          fee_delta: "102400ugnot",
        } as unknown as Event);
      }
      deliverTx.push({
        responseBase: {
          error: failed
            ? {
              "@type": "/std.InsufficientCoinsError",
              value: "insufficient coins",
            }
            : null,
          data: new Uint8Array(),
          events,
          log: failed ? "insufficient coins" : "",
          info: "",
        },
        gasWanted: 200000n,
        gasUsed: failed ? 200000n : 150000n,
      } as unknown as TxResult);
    }
    return {
      height,
      results: {
        deliverTx,
        beginBlock: {
          responseBase: {
            error: null,
            data: new Uint8Array(),
            events: [],
            log: "",
            info: "",
          },
        },
        endBlock: {
          responseBase: {
            error: null,
            data: new Uint8Array(),
            events: [],
            log: "",
            info: "",
          },
          validatorUpdates: null,
          consensusParams: null,
          events: null,
        },
      },
    } as unknown as BlockResultsResponse;
  }

  async validators(_params: ValidatorsParams): Promise<ValidatorsResponse> {
    return {
      blockHeight: _params.height ?? this.endHeight,
      validators: this.validatorSet(),
    };
  }

  /**
   * Answers ABCI queries. Only `auth/accounts/<address>` and `bank/balances/<address>` are
   * served, with synthetic data; anything else gets the error a gnoland node returns for an
   * unknown path.
   */
  async abciQuery(params: AbciQueryParams): Promise<AbciQueryResponse> {
    this.queries.push(params.path);
    const reply = (value: Uint8Array, error: {
      "@type": string
      value: string
    } | null = null): AbciQueryResponse => ({
      responseBase: {
        error,
        data: new Uint8Array(),
        events: [],
        log: "",
        info: "",
      },
      key: new Uint8Array(),
      value,
      height: params.height,
    } as unknown as AbciQueryResponse);
    if (params.path.startsWith("bank/balances/")) {
      return reply(Buffer.from(JSON.stringify("1000000ugnot")));
    }
    if (params.path.startsWith("auth/accounts/")) {
      const address = params.path.slice("auth/accounts/".length);
      return reply(Buffer.from(JSON.stringify({
        BaseAccount: {
          address,
          coins: "1000000ugnot",
          public_key: null,
          account_number: "1",
          sequence: "0",
        },
      })));
    }
    return reply(new Uint8Array(), {
      "@type": "/std.UnknownRequestError",
      value: "unknown request: " + params.path,
    });
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

/**
 * Factory function to create a mock Tendermint2 client
 */
export function createMockTm2Client(config: MockTm2Config): Tm2Client {
  return new MockTm2Client(config) as unknown as Tm2Client;
}
