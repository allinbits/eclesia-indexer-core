-- Validator set as observed block by block (full indexing mode)
CREATE TABLE validators
(
    address           TEXT    PRIMARY KEY,           -- bech32 g1... address
    pubkey            JSONB,                         -- Public key as reported by the node
    voting_power      BIGINT  NOT NULL,
    active            BOOLEAN NOT NULL DEFAULT TRUE, -- Present in the latest observed set
    first_seen_height BIGINT  NOT NULL,
    last_seen_height  BIGINT  NOT NULL
);
CREATE INDEX validators_active_index ON validators (active);

-- One row per change of a validator's voting power; 0 when it leaves the set
CREATE TABLE validator_power_history
(
    address      TEXT   NOT NULL REFERENCES validators (address),
    height       BIGINT NOT NULL,
    voting_power BIGINT NOT NULL,
    PRIMARY KEY (address, height)
);
CREATE INDEX validator_power_history_height_index ON validator_power_history (height);
