import {
  GenesisTxMetadata, MessageDecoder, messageDecoders, Tx,
} from "@eclesia/chain-gno";
import {
  Utils,
} from "@eclesia/indexer-engine";

/**
 * JSON.stringify that survives chain payloads: bigints become decimal strings and raw bytes
 * become base64, instead of an object with one key per byte.
 */
export const jsonStringify = (obj: unknown): string => {
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (value instanceof Uint8Array) {
      return Buffer.from(value).toString("base64");
    }
    return value;
  });
};

/** Upper-case hex of raw bytes, the form gnoland and gnoweb display hashes in */
export const hexUpper = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex").toUpperCase();

/** Bech32 `g1...` form of a raw 20-byte address, as validator sets report them */
export const gnoAddress = (bytes: Uint8Array): string => Utils.chainAddressfromKeyhash("g", Buffer.from(bytes).toString("hex"));

/** Realms live under `<domain>/r/`; pure packages under `<domain>/p/` */
export const isRealmPath = (path: string): boolean => /^[^/]+\/r\//.test(path);

/** A source file of a package, with its body optionally left out */
export type StoredFile = {
  name: string
  body?: string
  size: number
};

/** Trims file bodies out of a decoded package so transaction rows stay small */
export const summarizeFiles = (files: Array<{
  name: string
  body: string
}> | undefined, includeBodies: boolean): StoredFile[] => {
  return (files ?? []).map(file => (includeBodies
    ? {
      name: file.name,
      body: file.body,
      size: Buffer.byteLength(file.body),
    }
    : {
      name: file.name,
      size: Buffer.byteLength(file.body),
    }));
};

export type DecodedMessage = {
  "@type": string
} & Record<string, unknown>;

/**
 * Decodes a transaction's messages into JSON-ready objects tagged with their type URL. Messages
 * without a decoder are kept as base64 so nothing is lost. Package sources are summarised
 * unless `includeFileBodies` is set, since the packages module stores them in full.
 */
export const decodeMessages = (
  messages: Tx["messages"],
  decoders: Record<string, MessageDecoder> = messageDecoders,
  includeFileBodies = false,
): DecodedMessage[] => {
  return messages.map((message) => {
    const decoder = decoders[message.typeUrl];
    if (!decoder) {
      return {
        "@type": message.typeUrl,
        value: Buffer.from(message.value).toString("base64"),
      };
    }
    const decoded = decoder.decode(message.value) as Record<string, unknown>;
    const pkg = decoded.package as {
      name: string
      path: string
      files: Array<{
        name: string
        body: string
      }>
    } | undefined;
    if (pkg && Array.isArray(pkg.files)) {
      return {
        "@type": message.typeUrl,
        ...decoded,
        package: {
          ...pkg,
          files: summarizeFiles(pkg.files, includeFileBodies),
        },
      };
    }
    return {
      "@type": message.typeUrl,
      ...decoded,
    };
  });
};

/** Integer from an amino JSON number, which may arrive as a string; null when absent or invalid */
export const aminoInt = (value: string | number | undefined | null): number | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Date of a genesis transaction from its metadata (Unix seconds), or null */
export const genesisTimestamp = (metadata: GenesisTxMetadata | null | undefined): Date | null => {
  const seconds = aminoInt(metadata?.timestamp);
  return seconds === null || seconds <= 0 ? null : new Date(seconds * 1000);
};
