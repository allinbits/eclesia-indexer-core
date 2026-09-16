import type {
  Event,
} from "@gnolang/tm2-rpc";

/** One amount of one denomination */
export type Coin = {
  denom: string
  amount: bigint
};

/**
 * Parses the string form Tendermint2 uses for coins: `<amount><denom>` entries joined by commas,
 * for example `1000000ugnot` or `5ugnot,10/r/demo/token:tok`. The empty string is no coins.
 * Throws on anything else, since a silently dropped amount would corrupt balances.
 */
export function parseCoins(coins: string | undefined | null): Coin[] {
  if (!coins) {
    return [];
  }
  return coins.split(",").map((entry) => {
    const match = /^\s*(-?\d+)([A-Za-z][A-Za-z0-9/:._-]*)\s*$/.exec(entry);
    if (!match) {
      throw new Error("Malformed coins string: " + JSON.stringify(coins));
    }
    return {
      amount: BigInt(match[1]),
      denom: match[2],
    };
  });
}

/** Amino type of the event the bank module emits for every coin movement, fees and deposits included */
export const TRANSFER_EVENT = "/bank.TransferEvent";

/** A bank transfer as the chain reports it */
export type TransferEvent = {
  from: string
  to: string
  coins: Coin[]
  raw: string // The coins string as emitted
};

/** Reads a `/bank.TransferEvent`, or null for any other event */
export function parseTransferEvent(event: Event): TransferEvent | null {
  if (event["@type"] !== TRANSFER_EVENT) {
    return null;
  }
  const raw = String((event as Record<string, unknown>).coins ?? "");
  return {
    from: String((event as Record<string, unknown>).from ?? ""),
    to: String((event as Record<string, unknown>).to ?? ""),
    coins: parseCoins(raw),
    raw,
  };
}
