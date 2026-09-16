import * as path from "node:path";
import {
  fileURLToPath,
} from "node:url";

import {
  loadMigrations, PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  GnoAdapter, pubKeyAddress, PubKeyAny,
  pubKeyBytes,
} from "@eclesia/chain-gno";
import {
  EclesiaIndexer, Types,
} from "@eclesia/indexer-engine";

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** The key as stored: its amino type and its raw bytes in base64 */
function storedKey(key: PubKeyAny | undefined): {
  type: string
  key: string
  address: string | null
} | null {
  if (!key) {
    return null;
  }
  const bytes = pubKeyBytes(key) ?? key.value;
  return {
    type: key.typeUrl,
    key: Buffer.from(bytes).toString("base64"),
    address: pubKeyAddress(key),
  };
}

/**
 * Sessions module for gno.land: every session key a master account creates, with its expiry,
 * allowed paths and spend allowance, and when it was revoked. The derived session address is
 * what `transactions.session_address` carries for transactions signed through the key.
 */
export class SessionsModule implements Types.IndexingModule<GnoAdapter> {
  indexer!: EclesiaIndexer<GnoAdapter>;

  private pgIndexer!: PgIndexer<GnoAdapter>;

  public name: string = "gno.sessions";

  public depends: string[] = ["blocks"];

  public provides: string[] = ["gno.sessions"];

  async setup() {
    await this.pgIndexer.applyMigrations(this.name, loadMigrations(path.join(__dirname, "sql")), "auth_sessions");
  }

  init(pgIndexer: PgIndexer<GnoAdapter>): void {
    this.pgIndexer = pgIndexer;
    this.indexer = pgIndexer.indexer;

    this.indexer.on("/auth.m_create_session", async (event) => {
      const {
        msg, txHash,
      } = event.value;
      const key = storedKey(msg.sessionKey);
      if (!key) {
        this.indexer.log.warn("Session created without a key in tx " + txHash);
        return;
      }
      const endTimer = this.indexer.prometheus?.timeDatabaseQuery("add-session") ?? void 0;
      await this.pgIndexer.getInstance().query({
        name: "add-session",
        text: "INSERT INTO auth_sessions(session_address, master_address, key_type, key, created_height, created_tx_hash, expires_at, allow_paths, spend_limit, spend_period, timestamp) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        values: [key.address, msg.creator, key.type, key.key, event.height, txHash, msg.expiresAt > 0n ? new Date(Number(msg.expiresAt) * 1000) : null, msg.allowPaths, msg.spendLimit || null, msg.spendPeriod > 0n ? msg.spendPeriod.toString() : null, event.timestamp],
      });
      endTimer?.();
    });

    this.indexer.on("/auth.m_revoke_session", async (event) => {
      const {
        msg, txHash,
      } = event.value;
      const key = storedKey(msg.sessionKey);
      if (!key) {
        return;
      }
      const endTimer = this.indexer.prometheus?.timeDatabaseQuery("revoke-session") ?? void 0;
      await this.pgIndexer.getInstance().query({
        name: "revoke-session",
        text: "UPDATE auth_sessions SET revoked_height = $3, revoked_tx_hash = $4 WHERE master_address = $1 AND key = $2 AND revoked_height IS NULL",
        values: [msg.creator, key.key, event.height, txHash],
      });
      endTimer?.();
    });

    this.indexer.on("/auth.m_revoke_all_sessions", async (event) => {
      const {
        msg, txHash,
      } = event.value;
      const endTimer = this.indexer.prometheus?.timeDatabaseQuery("revoke-all-sessions") ?? void 0;
      await this.pgIndexer.getInstance().query({
        name: "revoke-all-sessions",
        text: "UPDATE auth_sessions SET revoked_height = $2, revoked_tx_hash = $3, revoked_all = TRUE WHERE master_address = $1 AND revoked_height IS NULL",
        values: [msg.creator, event.height, txHash],
      });
      endTimer?.();
    });
  }
}
