import type {
  GenesisBalance, ParsedGenesisBalance,
} from "./types.js";

/**
 * Normalises a genesis balance entry. Amino writes `<address>=<coins>` with an optional
 * `;vesting=<coins>,<start>,<end>` and `;type=delayed` suffix; some tools write an object with
 * `address` and `amount`. Throws on an entry that is neither.
 */
export function parseGenesisBalance(entry: GenesisBalance): ParsedGenesisBalance {
  if (typeof entry !== "string") {
    if (!entry || typeof entry.address !== "string") {
      throw new Error("Malformed genesis balance entry: " + JSON.stringify(entry));
    }
    const vesting = entry.vesting;
    return {
      address: entry.address,
      amount: entry.amount ?? "",
      vesting: vesting && vesting.original_vesting
        ? {
          originalVesting: vesting.original_vesting,
          startTime: Number(vesting.start_time ?? 0),
          endTime: Number(vesting.end_time ?? 0),
          delayed: vesting.type === "delayed",
        }
        : null,
    };
  }
  const parts = entry.trim().split(";");
  const [address, amount] = parts[0].split("=", 2);
  if (!address || amount === undefined) {
    throw new Error("Malformed genesis balance entry: " + JSON.stringify(entry));
  }
  let vesting: ParsedGenesisBalance["vesting"] = null;
  let delayed = false;
  for (const part of parts.slice(1)) {
    const [key, value] = part.split("=", 2);
    if (key === "vesting" && value) {
      const [originalVesting, start, end] = value.split(",");
      vesting = {
        originalVesting,
        startTime: Number(start ?? 0),
        endTime: Number(end ?? 0),
        delayed: false,
      };
    }
    else if (key === "type" && value === "delayed") {
      delayed = true;
    }
  }
  if (vesting) {
    vesting.delayed = delayed;
  }
  return {
    address,
    amount,
    vesting,
  };
}
