CREATE TABLE balances (
    address TEXT NOT NULL REFERENCES accounts (address),
    coins COIN[]  NOT NULL DEFAULT '{}',
    height  BIGINT REFERENCES blocks (height),
    CONSTRAINT unique_height_balance UNIQUE (address, height)
);

CREATE INDEX balances_address_index ON balances (address);
CREATE INDEX balances_height_index ON balances (height DESC NULLS LAST);

CREATE TABLE supply
(
    coins      COIN[]  NOT NULL,
    height     BIGINT REFERENCES blocks (height)
);
CREATE INDEX supply_height_index ON supply (height DESC NULLS LAST);