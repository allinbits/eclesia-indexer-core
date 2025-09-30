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
