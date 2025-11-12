
-- Core blocks table storing blockchain block metadata
CREATE TABLE blocks
(
    height           BIGINT  UNIQUE PRIMARY KEY,        -- Block height (sequential number)
    hash             TEXT    NOT NULL UNIQUE,           -- Block hash in hexadecimal
    num_txs          INTEGER DEFAULT 0,                 -- Number of transactions in block
    total_gas        BIGINT  DEFAULT 0,                 -- Total gas used by all transactions
    proposer_address TEXT,                              -- Validator address that proposed this block
    signed_by        JSONB   NOT NULL DEFAULT '[]'::JSONB, -- Array of validator signatures
    timestamp        TIMESTAMP WITHOUT TIME ZONE NOT NULL -- Block creation timestamp
);
-- Indexes for efficient block queries
CREATE INDEX block_height_index ON blocks (height);
CREATE INDEX block_time_index ON blocks (timestamp);
CREATE INDEX block_hash_index ON blocks (hash);
CREATE INDEX block_proposer_address_index ON blocks (proposer_address);

-- Transactions table storing complete transaction data and execution results
CREATE TABLE transactions
(
    hash         TEXT    NOT NULL,                      -- Transaction hash (SHA-256)
    height       BIGINT  NOT NULL REFERENCES blocks (height), -- Block height containing this tx
    success      BOOLEAN NOT NULL,                      -- Whether transaction executed successfully

    /* Transaction Body Fields */
    messages     JSONB   NOT NULL DEFAULT '[]'::JSONB,  -- Decoded messages with type information
    memo         TEXT,                                  -- Optional transaction memo
    signatures   TEXT[]  NOT NULL,                      -- Raw signatures as text array

    /* AuthInfo Fields */
    signer_infos JSONB   NOT NULL DEFAULT '[]'::JSONB,  -- Signer information and sequence numbers
    fee          JSONB   NOT NULL DEFAULT '{}'::JSONB, -- Fee amount and gas limit

    /* Transaction Execution Results */
    gas_wanted   BIGINT           DEFAULT 0,            -- Gas requested for execution
    gas_used     BIGINT           DEFAULT 0,            -- Actual gas consumed
    raw_log      TEXT,                                  -- Raw execution log output
    logs         JSONB,                                 -- Structured event logs

    CONSTRAINT unique_tx UNIQUE (hash, height)
);
-- Indexes for efficient transaction queries
CREATE INDEX transaction_height_index ON transactions (height  DESC NULLS LAST);

ALTER TABLE transactions ALTER COLUMN messages SET STORAGE EXTERNAL;
ALTER TABLE transactions ALTER COLUMN logs SET STORAGE EXTERNAL;
ALTER TABLE transactions ALTER COLUMN signer_infos SET STORAGE EXTERNAL;
ALTER TABLE transactions ALTER COLUMN fee SET STORAGE EXTERNAL;

-- Single-row tables for storing network performance metrics
-- These use a boolean primary key trick to ensure only one row exists

-- Average block time calculated over the last minute
CREATE TABLE average_block_time_per_minute
(
    one_row_id   BOOL    NOT NULL DEFAULT TRUE PRIMARY KEY, -- Ensures single row
    average_time DECIMAL NOT NULL,                           -- Average time in seconds
    height       BIGINT  NOT NULL,                           -- Block height when calculated
    CHECK (one_row_id)                                       -- Constraint to enforce TRUE value
);
CREATE INDEX average_block_time_per_minute_height_index ON average_block_time_per_minute (height);

-- Average block time calculated over the last hour
CREATE TABLE average_block_time_per_hour
(
    one_row_id   BOOL    NOT NULL DEFAULT TRUE PRIMARY KEY, -- Ensures single row
    average_time DECIMAL NOT NULL,                           -- Average time in seconds
    height       BIGINT  NOT NULL,                           -- Block height when calculated
    CHECK (one_row_id)                                       -- Constraint to enforce TRUE value
);
CREATE INDEX average_block_time_per_hour_height_index ON average_block_time_per_hour (height);

-- Average block time calculated over the last day
CREATE TABLE average_block_time_per_day
(
    one_row_id   BOOL    NOT NULL DEFAULT TRUE PRIMARY KEY, -- Ensures single row
    average_time DECIMAL NOT NULL,                           -- Average time in seconds
    height       BIGINT  NOT NULL,                           -- Block height when calculated
    CHECK (one_row_id)                                       -- Constraint to enforce TRUE value
);
CREATE INDEX average_block_time_per_day_height_index ON average_block_time_per_day (height);

-- Custom PostgreSQL type for representing cryptocurrency coins
-- Used throughout the system for fee and balance storage
CREATE TYPE COIN AS
(
    denom  TEXT, -- Denomination (e.g., 'uatom', 'stake')
    amount TEXT  -- Amount as string to handle large numbers
);

