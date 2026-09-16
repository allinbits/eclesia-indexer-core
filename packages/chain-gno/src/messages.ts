import {
  gno,
} from "@gnolang/gno-types";

/** Amino type URLs of the messages a gno.land transaction can carry */
export const MSG_SEND = "/bank.MsgSend";
export const MSG_CALL = "/vm.m_call";
export const MSG_ADD_PACKAGE = "/vm.m_addpkg";
export const MSG_RUN = "/vm.m_run";
export const MSG_ENABLE_PACKAGE = "/vm.m_enable_pkg";
export const MSG_REJECT_PACKAGE = "/vm.m_reject_pkg";
export const MSG_CREATE_SESSION = "/auth.m_create_session";
export const MSG_REVOKE_SESSION = "/auth.m_revoke_session";
export const MSG_REVOKE_ALL_SESSIONS = "/auth.m_revoke_all_sessions";

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
  [MSG_ENABLE_PACKAGE]: gno.gno.vm.vm.MsgEnablePackage,
  [MSG_REJECT_PACKAGE]: gno.gno.vm.vm.MsgRejectPackage,
  [MSG_CREATE_SESSION]: gno.gno.auth.auth.MsgCreateSession,
  [MSG_REVOKE_SESSION]: gno.gno.auth.auth.MsgRevokeSession,
  [MSG_REVOKE_ALL_SESSIONS]: gno.gno.auth.auth.MsgRevokeAllSessions,
};

/** Decoded message types, by type URL */
export type MsgSend = gno.gno.bank.bank.MsgSend;
export type MsgCall = gno.gno.vm.vm.MsgCall;
export type MsgAddPackage = gno.gno.vm.vm.MsgAddPackage;
export type MsgRun = gno.gno.vm.vm.MsgRun;
/** Approves a parked package on chains with `code_submission_policy: inert` (gno.land); `pkgHeight` is the submission height */
export type MsgEnablePackage = gno.gno.vm.vm.MsgEnablePackage;
/** Rejects a parked package */
export type MsgRejectPackage = gno.gno.vm.vm.MsgRejectPackage;
/** Session keys: a master account authorises a key for a while, for some paths and spend */
export type MsgCreateSession = gno.gno.auth.auth.MsgCreateSession;
export type MsgRevokeSession = gno.gno.auth.auth.MsgRevokeSession;
export type MsgRevokeAllSessions = gno.gno.auth.auth.MsgRevokeAllSessions;
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
