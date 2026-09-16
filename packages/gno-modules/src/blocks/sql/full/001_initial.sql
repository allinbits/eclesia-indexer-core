-- Blocks of a gno.land (Tendermint2) chain
CREATE TABLE blocks
(
    height           BIGINT      PRIMARY KEY,               -- Block height
    hash             TEXT        NOT NULL UNIQUE,           -- Block hash, upper-case hex
    num_txs          INTEGER     NOT NULL DEFAULT 0,        -- Transactions in the block
    total_gas        BIGINT      NOT NULL DEFAULT 0,        -- Gas used by all transactions
    proposer_address TEXT,                                  -- Validator that proposed the block (bech32)
    signed_by        JSONB       NOT NULL DEFAULT '[]'::JSONB, -- Validators whose precommit is in the last commit of the next block
    timestamp        TIMESTAMPTZ NOT NULL                   -- Block time
);
CREATE INDEX block_time_index ON blocks (timestamp);
CREATE INDEX block_proposer_address_index ON blocks (proposer_address);

-- Transactions with their decoded messages and execution results
CREATE TABLE transactions
(
    hash        TEXT    NOT NULL,                              -- sha256 of the raw transaction, upper-case hex
    height      BIGINT  NOT NULL REFERENCES blocks (height),   -- Block containing the transaction
    index       INTEGER NOT NULL,                              -- Position in the block
    success     BOOLEAN NOT NULL,                              -- Executed without error
    messages    JSONB   NOT NULL DEFAULT '[]'::JSONB,          -- Decoded messages tagged with @type
    memo        TEXT,
    signatures  JSONB   NOT NULL DEFAULT '[]'::JSONB,          -- Public keys and signatures (base64)
    fee         JSONB   NOT NULL DEFAULT '{}'::JSONB,          -- gas_wanted and gas_fee
    gas_wanted  BIGINT  NOT NULL DEFAULT 0,
    gas_used    BIGINT  NOT NULL DEFAULT 0,
    error       JSONB,                                         -- @type and value of the error, null on success
    log         TEXT,
    events      JSONB   NOT NULL DEFAULT '[]'::JSONB,          -- Events the transaction emitted
    CONSTRAINT unique_tx UNIQUE (hash, height)
);
CREATE INDEX transaction_height_index ON transactions (height DESC NULLS LAST);
CREATE INDEX transaction_hash_index ON transactions (hash);
ALTER TABLE transactions ALTER COLUMN messages SET STORAGE EXTERNAL;
ALTER TABLE transactions ALTER COLUMN events SET STORAGE EXTERNAL;

-- Single-row tables for network performance metrics (boolean primary key trick)
CREATE TABLE average_block_time_per_minute
(
    one_row_id   BOOL    NOT NULL DEFAULT TRUE PRIMARY KEY,
    average_time DECIMAL NOT NULL,
    height       BIGINT  NOT NULL,
    CHECK (one_row_id)
);
CREATE TABLE average_block_time_per_hour
(
    one_row_id   BOOL    NOT NULL DEFAULT TRUE PRIMARY KEY,
    average_time DECIMAL NOT NULL,
    height       BIGINT  NOT NULL,
    CHECK (one_row_id)
);
CREATE TABLE average_block_time_per_day
(
    one_row_id   BOOL    NOT NULL DEFAULT TRUE PRIMARY KEY,
    average_time DECIMAL NOT NULL,
    height       BIGINT  NOT NULL,
    CHECK (one_row_id)
);
