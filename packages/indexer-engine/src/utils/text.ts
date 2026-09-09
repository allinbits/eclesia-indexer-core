/**
 * Decodes blockchain event attributes from various formats to strings
 * Handles both string and Uint8Array inputs from Tendermint events
 * @param x - The attribute value to decode (string or Uint8Array)
 * @returns Decoded string value
 */
export const decodeAttr = (x: Uint8Array | string) => {
  if (typeof x === "string") {
    return x;
  }
  else if (x instanceof Uint8Array) {
    return Buffer.from(x).toString();
  }
  else {
    return "";
  }
};

/** Minimal shape of an ABCI event, compatible with both CometBFT 0.37 and 0.38 response types */
export type ModeTaggedEvent = {
  attributes: readonly {
    key: Uint8Array | string
    value: Uint8Array | string
  }[]
};

/** Values Cosmos SDK 0.50+ stamps on `finalize_block_events` to mark their origin (baseapp.go) */
export type BlockEventMode = "BeginBlock" | "EndBlock";

const MODE_SPELLINGS: Record<BlockEventMode, readonly string[]> = {
  BeginBlock: ["BeginBlock", "begin_block"],
  EndBlock: ["EndBlock", "end_block"],
};

/**
 * Checks whether a finalize_block event carries the given `mode` attribute.
 * The SDK emits `mode=BeginBlock` / `mode=EndBlock`; the snake_case spellings
 * are accepted as well so forks that lowercase the value keep working.
 * @param event - Event with an attributes array
 * @param mode - Which phase of the block the event must belong to
 * @returns true when the event has a matching `mode` attribute
 */
export const hasBlockEventMode = (event: ModeTaggedEvent, mode: BlockEventMode): boolean => {
  const accepted = MODE_SPELLINGS[mode];
  return event.attributes.some(a => decodeAttr(a.key) === "mode" && accepted.includes(decodeAttr(a.value)));
};

/**
 * Returns a URL that is safe to log: the password part of any credentials is masked.
 * Strings that do not parse as a URL are returned unchanged.
 */
export const redactUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  }
  catch (_e) {
    return url;
  }
};
