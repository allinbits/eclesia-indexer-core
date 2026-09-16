import type {
  BlockResultsResponse, Event, TxResult,
} from "@gnolang/tm2-rpc";

/** `block_results` as the node sends it, before tm2-rpc's decoding */
export type RawBlockResults = {
  height: string
  results: {
    deliver_tx: RawTxResult[] | null
    begin_block: RawBlockPhase | null
    end_block: (RawBlockPhase & {
      ValidatorUpdates?: unknown
      ConsensusParams?: unknown
      Events?: unknown
    }) | null
  }
};

export type RawResponseBase = {
  Error: {
    "@type": string
    value: string
  } | null
  Data: string | null
  Events: RawEvent[] | null
  Log: string
  Info: string
};

export type RawTxResult = {
  ResponseBase: RawResponseBase
  GasWanted: string | null
  GasUsed: string | null
};

export type RawBlockPhase = {
  ResponseBase: RawResponseBase
};

/** Any ABCI event: realm events carry type/attrs/pkg_path, bank transfers from/to/coins, storage events bytes_delta... */
export type RawEvent = {
  "@type"?: string
  type?: string
  pkg_path?: string
  attrs?: Array<{
    key: string
    value: string | null
  }> | null
  [key: string]: unknown
};

/**
 * Decodes an event without assuming it came from a realm. tm2-rpc requires `pkg_path` on every
 * event and throws on the bank module's `/bank.TransferEvent`, which only carries `from`, `to`
 * and `coins`; here the realm fields default to empty and every other field passes through.
 */
export function decodeRawEvent(event: RawEvent): Event {
  const {
    "@type": atType, type, pkg_path, attrs, ...extra
  } = event;
  return {
    ...extra,
    "@type": atType ?? "",
    type: type ?? "",
    pkg_path: pkg_path ?? "",
    attrs: (attrs ?? []).map(attribute => ({
      key: attribute.key,
      value: attribute.value ?? "",
    })),
  };
}

function decodeResponseBase(base: RawResponseBase | undefined | null): TxResult["responseBase"] {
  return {
    error: (base?.Error ?? null) as TxResult["responseBase"]["error"],
    data: base?.Data ? new Uint8Array(Buffer.from(base.Data, "base64")) : new Uint8Array(),
    events: (base?.Events ?? []).map(decodeRawEvent),
    log: base?.Log ?? "",
    info: base?.Info ?? "",
  };
}

function decodeTxResult(result: RawTxResult): TxResult {
  return {
    responseBase: decodeResponseBase(result.ResponseBase),
    gasWanted: BigInt(result.GasWanted ?? "0"),
    gasUsed: BigInt(result.GasUsed ?? "0"),
  };
}

/** Decodes a raw `block_results` reply into the shape tm2-rpc's `blockResults()` returns */
export function decodeBlockResults(raw: RawBlockResults): BlockResultsResponse {
  return {
    height: Number(raw.height),
    results: {
      deliverTx: (raw.results.deliver_tx ?? []).map(decodeTxResult),
      beginBlock: {
        responseBase: decodeResponseBase(raw.results.begin_block?.ResponseBase),
      },
      endBlock: {
        responseBase: decodeResponseBase(raw.results.end_block?.ResponseBase),
        validatorUpdates: null,
        consensusParams: null,
        events: null,
      },
    },
  };
}
