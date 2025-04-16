import { bech32 } from "bech32";

function toHexString(byteArray: number[]) {
  return Array.prototype.map
    .call(byteArray, (byte) => {
      return ("0" + (byte & 0xff).toString(16)).slice(-2);
    })
    .join("");
}
function keyHashfromAddress(address: string): string {
  try {
    return toHexString(bech32.fromWords(bech32.decode(address).words));
  } catch (_e) {
    throw new Error("Could not decode address");
  }
}
function chainAddressfromKeyhash(prefix: string, keyhash: string) {
  const words = bech32.toWords(Buffer.from(keyhash, "hex"));

  return keyhash !== "" ? bech32.encode(prefix, words) : "";
}

export { chainAddressfromKeyhash, keyHashfromAddress, toHexString };
