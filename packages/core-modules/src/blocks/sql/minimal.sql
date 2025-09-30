
-- Minimal blocks table for basic block tracking
-- Only stores essential block information without transaction details
CREATE TABLE blocks
(
    height           BIGINT  UNIQUE PRIMARY KEY,           -- Block height (sequential number)
    timestamp        TIMESTAMP WITHOUT TIME ZONE NOT NULL -- Block creation timestamp
);
-- Index for efficient block height queries
CREATE INDEX block_height_index ON blocks (height);

-- Custom PostgreSQL type for representing cryptocurrency coins
-- Used throughout the system for fee and balance storage
CREATE TYPE COIN AS
(
    denom  TEXT, -- Denomination (e.g., 'uatom', 'stake')
    amount TEXT  -- Amount as string to handle large numbers
);
