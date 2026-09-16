import {
  createHash,
} from "node:crypto";

import {
  Utils,
} from "@eclesia/indexer-engine";
import {
  gno,
} from "@gnolang/gno-types";

/** Bech32 prefix of every gno.land address */
export const ADDRESS_PREFIX = "g";

/** The zero address; gno writes it into `TxSignature.sessionAddr` for master-key signatures */
export const ZERO_ADDRESS = "g1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqluuxe";

/** Amino type URLs of the public key kinds Tendermint2 accounts use */
export const PUBKEY_SECP256K1 = "/tm.PubKeySecp256k1";
export const PUBKEY_ED25519 = "/tm.PubKeyEd25519";

/** A public key as it travels inside messages and signatures */
export type PubKeyAny = {
  typeUrl: string
  value: Uint8Array
};

/**
 * The address of a public key, the way Tendermint2 derives it: ripemd160(sha256(key)) for
 * secp256k1 and the first 20 bytes of sha256(key) for ed25519, bech32-encoded with the `g`
 * prefix. Returns null for key kinds without a fixed derivation (multisig).
 */
export function pubKeyAddress(pubKey: PubKeyAny | undefined | null): string | null {
  if (!pubKey || pubKey.value.length === 0) {
    return null;
  }
  const raw = pubKeyBytes(pubKey);
  if (!raw) {
    return null;
  }
  const sha = createHash("sha256").update(raw).digest();
  const hash = pubKey.typeUrl === PUBKEY_SECP256K1
    ? createHash("ripemd160").update(sha).digest()
    : sha.subarray(0, 20);
  return Utils.chainAddressfromKeyhash(ADDRESS_PREFIX, hash.toString("hex"));
}

/** The raw key bytes inside a public key Any, or null for unsupported kinds */
export function pubKeyBytes(pubKey: PubKeyAny): Uint8Array | null {
  switch (pubKey.typeUrl) {
    case PUBKEY_SECP256K1:
    case PUBKEY_ED25519:
      // Both proto messages are a single bytes field; the secp256k1 decoder reads either
      return gno.tm2.tx.tx.PubKeySecp256k1.decode(pubKey.value).key;
    default:
      return null;
  }
}

/** A session address from a signature, or null when the master key signed (zero address or absent) */
export function sessionAddressOf(sessionAddr: string | undefined | null): string | null {
  return sessionAddr && sessionAddr !== ZERO_ADDRESS ? sessionAddr : null;
}
