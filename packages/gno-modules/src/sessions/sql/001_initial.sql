-- Session keys: a master account authorises a key for a while, for some realm paths and a spend allowance
CREATE TABLE auth_sessions
(
    id               BIGSERIAL   PRIMARY KEY,
    session_address  TEXT,                                     -- Address derived from the session key; matches transactions.session_address
    master_address   TEXT        NOT NULL,                     -- Account that created the session
    key_type         TEXT        NOT NULL,                     -- Amino type of the key (/tm.PubKeySecp256k1, /tm.PubKeyEd25519, ...)
    key              TEXT        NOT NULL,                     -- Key bytes, base64
    created_height   BIGINT      NOT NULL REFERENCES blocks (height),
    created_tx_hash  TEXT        NOT NULL,
    expires_at       TIMESTAMPTZ,                              -- Null when the session does not expire
    allow_paths      TEXT[]      NOT NULL DEFAULT '{}',        -- Realm paths the key may call
    spend_limit      TEXT,                                     -- Coins the key may spend per period
    spend_period     BIGINT,                                   -- Period of the spend limit, seconds
    revoked_height   BIGINT,
    revoked_tx_hash  TEXT,
    revoked_all      BOOLEAN     NOT NULL DEFAULT FALSE,       -- Revoked by a revoke-all rather than by key
    timestamp        TIMESTAMPTZ NOT NULL
);
CREATE INDEX auth_sessions_session_address_index ON auth_sessions (session_address);
CREATE INDEX auth_sessions_master_index ON auth_sessions (master_address);
CREATE INDEX auth_sessions_active_index ON auth_sessions (master_address, key) WHERE revoked_height IS NULL;
