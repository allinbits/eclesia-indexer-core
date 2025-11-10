/**
 * Mock RPC client for benchmarking and testing
 * Generates synthetic blockchain data without requiring an actual RPC node
 */
import {
  fromBase64, fromHex,
} from "@cosmjs/encoding";
import {
  BlockResponse,
  BlockResultsResponse,
  CometClient,
  fromRfc3339WithNanoseconds,
  StatusResponse,
  TxData,
} from "@cosmjs/tendermint-rpc";
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

  constructor({
    chainId,
    startHeight,
    endHeight,
    txPerBlock,
  }: {
    chainId: string
    startHeight: number
    endHeight: number
    txPerBlock: number
  }) {
    this.chainId = chainId;
    this.startHeight = startHeight;
    this.endHeight = endHeight;
    this.txPerBlock = txPerBlock;
  }

  async block(height: number): Promise<BlockResponse> {
    const txs: Uint8Array[] = [];
    for (let i = 0; i < this.txPerBlock; i++) {
      txs.push(generateMockTx(height, i));
    }
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
        hash: new Uint8Array(),
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
        network: "atomone-1",
        version: "0.37.15",
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

  async blockResults(height: number): Promise<BlockResultsResponse> {
    const results: TxData[] = [];
    for (let i = 0; i < this.txPerBlock; i++) {
      results.push({
        code: 0,
        data: Buffer.from("success"),
        log: JSON.stringify([
          {
            msg_index: 0,
            events: [],
          },
        ]),
        gasWanted: BigInt(200000),
        gasUsed: BigInt(150000),
        events: [],
        codespace: "",
      });
    }
    return {
      height: height,
      results: results,
      beginBlockEvents: [],
      endBlockEvents: [],
      validatorUpdates: [],
      consensusUpdates: undefined,
    };
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
