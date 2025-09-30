import {
  bech32,
} from "bech32";

/**
 * Converts a byte array to a hexadecimal string representation
 * @param byteArray - Array of bytes to convert
 * @returns Hexadecimal string
 */
function toHexString(byteArray: number[]) {
  return Array.prototype.map
    .call(
      byteArray, (byte) => {
        return ("0" + (byte & 0xff).toString(16)).slice(-2);
      },
    )
    .join("");
}

/**
 * Extracts the key hash from a bech32-encoded address
 * @param address - Bech32-encoded address string
 * @returns Hexadecimal key hash
 * @throws Error if address cannot be decoded
 */
function keyHashfromAddress(address: string): string {
  try {
    return toHexString(bech32.fromWords(bech32.decode(address).words));
  }
  catch (_e) {
    throw new Error("Could not decode address");
  }
}

/**
 * Creates a bech32-encoded address from a key hash and prefix
 * @param prefix - Address prefix (e.g., "cosmos", "cosmosvalcons")
 * @param keyhash - Hexadecimal key hash
 * @returns Bech32-encoded address or empty string if keyhash is empty
 */
function chainAddressfromKeyhash(prefix: string, keyhash: string) {
  const words = bech32.toWords(Buffer.from(
    keyhash, "hex",
  ));

  return keyhash !== ""
    ? bech32.encode(
      prefix, words,
    )
    : "";
}

export {
  chainAddressfromKeyhash, keyHashfromAddress, toHexString,
};
