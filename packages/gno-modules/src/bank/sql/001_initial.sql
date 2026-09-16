-- Every explicit coin movement the bank module reports (sends, realm sends, inert charges); fees
-- and storage deposits move coins without an event and only show up in balances
CREATE TABLE bank_transfers
(
    id           BIGSERIAL   PRIMARY KEY,
    height       BIGINT      NOT NULL REFERENCES blocks (height),
    phase        TEXT        NOT NULL,                         -- begin_block, tx, end_block
    tx_hash      TEXT,
    tx_index     INTEGER,
    event_index  INTEGER     NOT NULL,
    from_address TEXT        NOT NULL,
    to_address   TEXT        NOT NULL,
    coins        TEXT        NOT NULL,                         -- As emitted: "<amount><denom>[,...]"
    timestamp    TIMESTAMPTZ NOT NULL
);
CREATE INDEX bank_transfers_from_index ON bank_transfers (from_address);
CREATE INDEX bank_transfers_to_index ON bank_transfers (to_address);
CREATE INDEX bank_transfers_height_index ON bank_transfers (height);
CREATE INDEX bank_transfers_tx_hash_index ON bank_transfers (tx_hash);

-- Current balance per address and denomination, as the chain reports it; height is the block at which it last changed
CREATE TABLE balances
(
    address TEXT           NOT NULL,
    denom   TEXT           NOT NULL,
    amount  NUMERIC(78, 0) NOT NULL,
    height  BIGINT         NOT NULL,                           -- Block at which the balance last changed (0 for genesis)
    PRIMARY KEY (address, denom)
);
CREATE INDEX balances_height_index ON balances (height);

-- One row per change of a balance after genesis
CREATE TABLE balance_history
(
    address TEXT           NOT NULL,
    denom   TEXT           NOT NULL,
    amount  NUMERIC(78, 0) NOT NULL,
    height  BIGINT         NOT NULL,
    PRIMARY KEY (address, denom, height)
);
CREATE INDEX balance_history_height_index ON balance_history (height);
