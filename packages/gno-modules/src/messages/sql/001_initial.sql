-- One row per successful message, by type

CREATE TABLE bank_sends
(
    id           BIGSERIAL PRIMARY KEY,
    height       BIGINT      NOT NULL REFERENCES blocks (height),
    tx_hash      TEXT        NOT NULL,
    msg_index    INTEGER     NOT NULL,
    from_address TEXT        NOT NULL,
    to_address   TEXT        NOT NULL,
    amount       TEXT        NOT NULL,                        -- Coins as "<amount><denom>[,...]"
    timestamp    TIMESTAMPTZ NOT NULL
);
CREATE INDEX bank_sends_from_index ON bank_sends (from_address);
CREATE INDEX bank_sends_to_index ON bank_sends (to_address);
CREATE INDEX bank_sends_height_index ON bank_sends (height);
CREATE INDEX bank_sends_tx_hash_index ON bank_sends (tx_hash);

CREATE TABLE vm_calls
(
    id          BIGSERIAL PRIMARY KEY,
    height      BIGINT      NOT NULL REFERENCES blocks (height),
    tx_hash     TEXT        NOT NULL,
    msg_index   INTEGER     NOT NULL,
    caller      TEXT        NOT NULL,
    send        TEXT,
    max_deposit TEXT,
    pkg_path    TEXT        NOT NULL,
    func        TEXT        NOT NULL,
    args        JSONB       NOT NULL DEFAULT '[]'::JSONB,
    timestamp   TIMESTAMPTZ NOT NULL
);
CREATE INDEX vm_calls_caller_index ON vm_calls (caller);
CREATE INDEX vm_calls_pkg_path_index ON vm_calls (pkg_path);
CREATE INDEX vm_calls_pkg_func_index ON vm_calls (pkg_path, func);
CREATE INDEX vm_calls_height_index ON vm_calls (height);
CREATE INDEX vm_calls_tx_hash_index ON vm_calls (tx_hash);

CREATE TABLE vm_add_packages
(
    id          BIGSERIAL PRIMARY KEY,
    height      BIGINT      NOT NULL REFERENCES blocks (height),
    tx_hash     TEXT        NOT NULL,
    msg_index   INTEGER     NOT NULL,
    creator     TEXT        NOT NULL,
    pkg_name    TEXT,
    pkg_path    TEXT,
    send        TEXT,
    max_deposit TEXT,
    files_count INTEGER     NOT NULL DEFAULT 0,
    timestamp   TIMESTAMPTZ NOT NULL
);
CREATE INDEX vm_add_packages_creator_index ON vm_add_packages (creator);
CREATE INDEX vm_add_packages_pkg_path_index ON vm_add_packages (pkg_path);
CREATE INDEX vm_add_packages_height_index ON vm_add_packages (height);
CREATE INDEX vm_add_packages_tx_hash_index ON vm_add_packages (tx_hash);

CREATE TABLE vm_runs
(
    id          BIGSERIAL PRIMARY KEY,
    height      BIGINT      NOT NULL REFERENCES blocks (height),
    tx_hash     TEXT        NOT NULL,
    msg_index   INTEGER     NOT NULL,
    caller      TEXT        NOT NULL,
    send        TEXT,
    max_deposit TEXT,
    pkg_name    TEXT,
    files       JSONB       NOT NULL DEFAULT '[]'::JSONB,     -- Ephemeral sources, stored here since nothing else keeps them
    timestamp   TIMESTAMPTZ NOT NULL
);
CREATE INDEX vm_runs_caller_index ON vm_runs (caller);
CREATE INDEX vm_runs_height_index ON vm_runs (height);
CREATE INDEX vm_runs_tx_hash_index ON vm_runs (tx_hash);

-- Every event the chain emitted: realm events (std.Emit), storage events, and future kinds
CREATE TABLE gno_events
(
    id          BIGSERIAL PRIMARY KEY,
    height      BIGINT      NOT NULL REFERENCES blocks (height),
    phase       TEXT        NOT NULL,                         -- begin_block, tx, end_block
    tx_hash     TEXT,                                         -- Null for block-level events
    tx_index    INTEGER,
    event_index INTEGER     NOT NULL,                         -- Position within its phase / transaction
    amino_type  TEXT        NOT NULL,                         -- @type, e.g. /tm.gnoEvent
    type        TEXT        NOT NULL,                         -- Event type as emitted (e.g. "Transfer")
    pkg_path    TEXT        NOT NULL,                         -- Realm that emitted it
    attrs       JSONB       NOT NULL DEFAULT '[]'::JSONB,     -- [{key, value}] in emission order
    raw         JSONB       NOT NULL,                         -- The whole event, including type-specific fields
    timestamp   TIMESTAMPTZ NOT NULL
);
CREATE INDEX gno_events_height_index ON gno_events (height);
CREATE INDEX gno_events_tx_hash_index ON gno_events (tx_hash);
CREATE INDEX gno_events_pkg_type_index ON gno_events (pkg_path, type);
ALTER TABLE gno_events ALTER COLUMN raw SET STORAGE EXTERNAL;
