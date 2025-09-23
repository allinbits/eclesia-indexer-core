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
