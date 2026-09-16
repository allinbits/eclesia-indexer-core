import {
  gno,
} from "@gnolang/gno-types";

import {
  readFields, stringField, varintField,
} from "./proto.js";

/** Amino type URLs of the messages a gno.land transaction can carry */
export const MSG_SEND = "/bank.MsgSend";
export const MSG_CALL = "/vm.m_call";
export const MSG_ADD_PACKAGE = "/vm.m_addpkg";
export const MSG_RUN = "/vm.m_run";
export const MSG_ENABLE_PACKAGE = "/vm.m_enable_pkg";
export const MSG_REJECT_PACKAGE = "/vm.m_reject_pkg";

/** Decodes the amino/proto bytes of one message type */
export type MessageDecoder<T = unknown> = {
  decode: (bytes: Uint8Array) => T
};

/**
 * Approves a parked package (chains with `code_submission_policy: inert`, such as gno.land).
 * Not in gno-types 1.0.8 yet; decoded here from the amino/proto wire format.
 */
export type MsgEnablePackage = {
  approver: string // Address of the approver (one of the chain's pkg_approvers)
  pkgPath: string // Package being enabled
  pkgHash: string // Content hash of the sources being approved, hex
  pkgHeight: bigint // Submission height recorded when the package was parked
};

/** Rejects a parked package. Not in gno-types 1.0.8 yet. */
export type MsgRejectPackage = {
  sender: string
  pkgPath: string
};

export const MsgEnablePackageDecoder: MessageDecoder<MsgEnablePackage> = {
  decode: (bytes) => {
    const fields = readFields(bytes);
    return {
      approver: stringField(fields, 1),
      pkgPath: stringField(fields, 2),
      pkgHash: stringField(fields, 3),
      pkgHeight: varintField(fields, 4),
    };
  },
};

export const MsgRejectPackageDecoder: MessageDecoder<MsgRejectPackage> = {
  decode: (bytes) => {
    const fields = readFields(bytes);
    return {
      sender: stringField(fields, 1),
      pkgPath: stringField(fields, 2),
    };
  },
};

/**
 * Built-in decoders, keyed by type URL. Consumers can add their own for messages of custom
 * gno.land forks through the adapter's `decoders` option.
 */
export const messageDecoders: Record<string, MessageDecoder> = {
  [MSG_SEND]: gno.gno.bank.bank.MsgSend,
  [MSG_CALL]: gno.gno.vm.vm.MsgCall,
  [MSG_ADD_PACKAGE]: gno.gno.vm.vm.MsgAddPackage,
  [MSG_RUN]: gno.gno.vm.vm.MsgRun,
  [MSG_ENABLE_PACKAGE]: MsgEnablePackageDecoder,
  [MSG_REJECT_PACKAGE]: MsgRejectPackageDecoder,
};

/** Decoded message types, by type URL */
export type MsgSend = gno.gno.bank.bank.MsgSend;
export type MsgCall = gno.gno.vm.vm.MsgCall;
export type MsgAddPackage = gno.gno.vm.vm.MsgAddPackage;
export type MsgRun = gno.gno.vm.vm.MsgRun;
export type MemPackage = gno.gno.vm.vm.MemPackage;
export type MemFile = gno.gno.vm.vm.MemFile;

/** A gno.land transaction as decoded from its raw bytes */
export type Tx = gno.tm2.tx.tx.Tx;
export type TxFee = gno.tm2.tx.tx.TxFee;
export type TxSignature = gno.tm2.tx.tx.TxSignature;

/** Decodes a raw transaction */
export const decodeTx = (raw: Uint8Array): Tx => gno.tm2.tx.tx.Tx.decode(raw);

/** Encodes a transaction, for mocks and tests */
export const encodeTx = (tx: Tx): Uint8Array => gno.tm2.tx.tx.Tx.encode(tx).finish();
