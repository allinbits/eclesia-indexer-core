import type {
  Events,
} from "./types.js";

export {
  decodeGnoTx, gno, GnoAdapter, type GnoAdapterOptions,
} from "./adapter.js";
export {
  parseGenesisBalance,
} from "./genesis.js";
export {
  decodeTx, encodeTx, type MemFile, type MemPackage, type MessageDecoder, messageDecoders, MSG_ADD_PACKAGE, MSG_CALL, MSG_RUN, MSG_SEND,
  type MsgAddPackage, type MsgCall, type MsgRun, type MsgSend, type Tx, type TxFee, type TxSignature,
} from "./messages.js";
export * as Mocks from "./mocks/index.js";
export {
  RateLimiter, throttledRpcClient,
} from "./rate-limit.js";
export {
  BatchingHttpClient, type BatchOptions,
} from "./transport.js";
export type {
  GenesisBalance, GenesisMsg, GenesisMsgEvent, GenesisTx, GenesisTxMetadata, GnoBlock, Events as GnoEvents, GnoMsgEvent, GnoTx, GnoTxError, ParsedGenesisBalance,
} from "./types.js";

/**
 * Adds the gno block-level and genesis events to the engine's global EventMap, so any project
 * that imports this adapter gets typed `block`, `begin_block`, `tx`, message and `end_block`
 * handlers. One chain adapter package per TypeScript program: two chains declare `block` with
 * different payloads, which the merged interface rejects.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface EventMap extends Events {
  }
}
