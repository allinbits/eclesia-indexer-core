/* eslint-disable @stylistic/no-multi-spaces */
import type {
  BlockResponse, BlockResultsResponse, Event, Validator,
} from "@gnolang/tm2-rpc";

import type {
  MsgAddPackage, MsgCall, MsgEnablePackage, MsgRejectPackage, MsgRun, MsgSend, Tx, TxFee, TxSignature,
} from "./messages.js";

/** What the gno adapter fetches for one height */
export type GnoBlock = {
  block: BlockResponse                     // Block with its raw transactions
  blockResults: BlockResultsResponse       // Execution results (deliverTx, beginBlock, endBlock)
  validators?: readonly Validator[]        // Validator set at this height (full mode only)
};

/** Error a gno transaction failed with, as the node reports it */
export type GnoTxError = {
  "@type": string   // Amino type of the error (e.g. /std.InsufficientCoinsError)
  value: string     // Message
};

/** One transaction of a block, decoded, with its execution result */
export type GnoTx = {
  hash: string                       // sha256 of the raw transaction, upper-case hex (as gnoland reports it)
  index: number                      // Position in the block
  success: boolean                   // The node executed it without error
  error: GnoTxError | null
  gasWanted: bigint
  gasUsed: bigint
  fee: TxFee | undefined             // gasWanted limit and gasFee ("<amount><denom>")
  memo: string
  messages: Tx["messages"]           // Raw messages: type URL plus encoded bytes; decoded ones come as their own events
  signatures: TxSignature[]
  events: readonly Event[]           // Events the whole transaction emitted (gno has no per-message attribution)
  log: string
  info: string
  raw: Uint8Array
};

/** A decoded message with the transaction it came from */
export type GnoMsgEvent<T> = {
  msg: T
  txHash: string
  msgIndex: number
  events: readonly Event[]           // The transaction's events; gno does not tag events with a message index
  tx: GnoTx
};

/**
 * One entry of `app_state.balances` in a gno.land genesis file. Amino marshals a balance as
 * the string `<address>=<coins>[;vesting=<coins>,<start>,<end>[;type=delayed]]`; older tools
 * wrote objects. `parseGenesisBalance` accepts both.
 */
export type GenesisBalance = string | {
  address: string
  amount: string                     // Coins as "<amount><denom>[,<amount><denom>...]"
  vesting?: {
    original_vesting?: string
    start_time?: string | number
    end_time?: string | number
    type?: string
  } | null
};

/** A genesis balance in one shape, whichever form the file used */
export type ParsedGenesisBalance = {
  address: string
  amount: string
  vesting: {
    originalVesting: string
    startTime: number
    endTime: number
    delayed: boolean
  } | null
};

/** Provenance a hardfork genesis attaches to replayed transactions */
export type GenesisTxMetadata = {
  timestamp: string | number
  block_height?: string | number     // Original height on the source chain, when replayed
  chain_id?: string
  failed?: boolean
  gas_used?: string | number
  gas_wanted?: string | number
  source?: string
  note?: string
  [key: string]: unknown
};

/** A message inside a genesis transaction: amino JSON with its type under `@type` */
export type GenesisMsg = {
  "@type": string
  [key: string]: unknown
};

/** One entry of `app_state.txs` in a gno.land genesis file */
export type GenesisTx = {
  tx: {
    msg: GenesisMsg[]
    fee: {
      gas_wanted: string | number
      gas_fee: string
    }
    signatures: unknown[]
    memo: string
  }
  metadata?: GenesisTxMetadata | null
};

/** One genesis message, emitted as `gentx<@type>` */
export type GenesisMsgEvent = {
  msg: GenesisMsg
  msgIndex: number
  tx: GenesisTx["tx"]
  metadata: GenesisTxMetadata | null
};

/**
 * Events the gno adapter emits for every block, in this order: `block`, `begin_block`, then
 * per transaction `tx` followed (for successful transactions) by one event per message named
 * after its amino type URL, then `end_block`. Genesis events are emitted once at import.
 */
export type Events = {
  block: {
    value: {
      block: BlockResponse
      block_results: BlockResultsResponse
      validators: readonly Validator[] | undefined
    }
  }
  begin_block: {
    value: {
      events: readonly Event[]
      validators: readonly Validator[] | undefined
    }
  }
  tx: {
    value: GnoTx
  }
  "/bank.MsgSend": {
    value: GnoMsgEvent<MsgSend>
  }
  "/vm.m_call": {
    value: GnoMsgEvent<MsgCall>
  }
  "/vm.m_addpkg": {
    value: GnoMsgEvent<MsgAddPackage>
  }
  "/vm.m_run": {
    value: GnoMsgEvent<MsgRun>
  }
  "/vm.m_enable_pkg": {
    value: GnoMsgEvent<MsgEnablePackage>
  }
  "/vm.m_reject_pkg": {
    value: GnoMsgEvent<MsgRejectPackage>
  }
  end_block: {
    value: readonly Event[]
  }
  "genesis/array/app_state.balances": {
    value: GenesisBalance[]
  }
  "genesis/array/app_state.txs": {
    value: GenesisTx[]
  }
  "gentx/bank.MsgSend": {
    value: GenesisMsgEvent
  }
  "gentx/vm.m_call": {
    value: GenesisMsgEvent
  }
  "gentx/vm.m_addpkg": {
    value: GenesisMsgEvent
  }
  "gentx/vm.m_run": {
    value: GenesisMsgEvent
  }
  "gentx/vm.m_enable_pkg": {
    value: GenesisMsgEvent
  }
  "gentx/vm.m_reject_pkg": {
    value: GenesisMsgEvent
  }
};
