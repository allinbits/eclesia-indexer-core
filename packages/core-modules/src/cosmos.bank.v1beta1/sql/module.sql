-- Account balances table tracking coin holdings over time
-- Supports both genesis balances (height = NULL) and historical balances
CREATE TABLE balances (
    address TEXT NOT NULL REFERENCES accounts (address), -- Account address
    coins COIN[]  NOT NULL DEFAULT '{}',                 -- Array of coin balances
    height  BIGINT REFERENCES blocks (height),           -- Block height (NULL for genesis)
    CONSTRAINT unique_height_balance UNIQUE (address, height) -- One balance per account per height
);

-- Indexes for efficient balance queries
CREATE INDEX balances_address_index ON balances (address);
CREATE INDEX balances_height_index ON balances (height DESC NULLS LAST);

-- Total supply tracking table (not currently used in the indexer)
CREATE TABLE supply
(
    coins      COIN[]  NOT NULL,                        -- Total supply of all coins
    height     BIGINT REFERENCES blocks (height)        -- Block height when recorded
);
CREATE INDEX supply_height_index ON supply (height DESC NULLS LAST);
