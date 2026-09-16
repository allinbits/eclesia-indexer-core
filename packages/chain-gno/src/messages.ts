import {
  gno,
} from "@gnolang/gno-types";

/** Amino type URLs of the messages a gno.land transaction can carry */
export const MSG_SEND = "/bank.MsgSend";
export const MSG_CALL = "/vm.m_call";
export const MSG_ADD_PACKAGE = "/vm.m_addpkg";
export const MSG_RUN = "/vm.m_run";

/** Decodes the amino/proto bytes of one message type */
export type MessageDecoder<T = unknown> = {
  decode: (bytes: Uint8Array) => T
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
