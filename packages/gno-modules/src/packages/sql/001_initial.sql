-- Packages and realms deployed on the chain, from transactions and from genesis
CREATE TABLE packages
(
    path                 TEXT        PRIMARY KEY,           -- Import path, e.g. gno.land/r/demo/boards
    name                 TEXT        NOT NULL,              -- Package name as declared
    creator              TEXT        NOT NULL,              -- Deployer address
    is_realm             BOOLEAN     NOT NULL,              -- Path under <domain>/r/
    height               BIGINT,                            -- Block of the deploying transaction; null for genesis
    tx_hash              TEXT,
    msg_index            INTEGER,
    from_genesis         BOOLEAN     NOT NULL DEFAULT FALSE,
    genesis_block_height BIGINT,                            -- Original height when a hardfork genesis replayed it
    send                 TEXT,
    max_deposit          TEXT,
    files_count          INTEGER     NOT NULL DEFAULT 0,
    timestamp            TIMESTAMPTZ                        -- Block time, or the genesis entry's metadata time
);
CREATE INDEX packages_creator_index ON packages (creator);
CREATE INDEX packages_height_index ON packages (height);
CREATE INDEX packages_is_realm_index ON packages (is_realm);

CREATE TABLE package_files
(
    pkg_path TEXT NOT NULL REFERENCES packages (path),
    name     TEXT NOT NULL,
    body     TEXT NOT NULL,
    PRIMARY KEY (pkg_path, name)
);
ALTER TABLE package_files ALTER COLUMN body SET STORAGE EXTERNAL;
