/* ---- PARAMS ---- */
CREATE TABLE validator
(
    consensus_address TEXT NOT NULL PRIMARY KEY, /* Validator consensus address */
    consensus_pubkey  TEXT NOT NULL UNIQUE /* Validator consensus public key */
);
ALTER TABLE block ADD CONSTRAINT block_validator_fkey FOREIGN KEY(proposer_address) REFERENCES validator(consensus_address);

CREATE TABLE staking_params
(
    
    params     JSONB   NOT NULL,
    height     BIGINT
    
);
CREATE INDEX staking_params_height_index ON staking_params (height DESC NULLS LAST);

CREATE TABLE staked_balances 
(
    delegator TEXT             REFERENCES account (address),
    shares numeric NOT NULL,
    amount COIN NOT NULL,
    validator TEXT REFERENCES validator(consensus_address),
    height                   BIGINT REFERENCES block (height)
);
CREATE INDEX staked_balances_height_index ON staked_balances (height DESC NULLS LAST);
CREATE INDEX staked_balances_delegator_index ON staked_balances (delegator);
CREATE INDEX staked_balances_validator_index ON staked_balances (validator);
/* ---- POOL ---- */
CREATE TABLE staking_pool
(
    
    bonded_tokens            TEXT    NOT NULL,
    not_bonded_tokens        TEXT    NOT NULL,
    height                   BIGINT,
    CONSTRAINT unique_pool UNIQUE (bonded_tokens, not_bonded_tokens)
    
);
CREATE INDEX staking_pool_height_index ON staking_pool (height DESC NULLS LAST);

/* ---- VALIDATORS INFO ---- */

CREATE TABLE validator_info
(
    consensus_address     TEXT   NOT NULL UNIQUE REFERENCES validator (consensus_address),
    operator_address      TEXT   NOT NULL UNIQUE,
    self_delegate_address TEXT REFERENCES account (address),
    max_change_rate       TEXT   NOT NULL,
    max_rate              TEXT   NOT NULL,
    height                BIGINT REFERENCES block (height)
);
CREATE INDEX validator_info_operator_address_index ON validator_info (operator_address);
CREATE INDEX validator_info_consensus_address_index ON validator_info (consensus_address);
CREATE INDEX validator_info_self_delegate_address_index ON validator_info (self_delegate_address);

CREATE TABLE validator_description
(
    validator_address TEXT   NOT NULL REFERENCES validator_info (operator_address) ,
    moniker           TEXT,
    identity          TEXT,
    avatar_url        TEXT,
    website           TEXT,
    security_contact  TEXT,
    details           TEXT,
    height                BIGINT REFERENCES block (height)
);
CREATE INDEX validator_description_height_index ON validator_description (height DESC NULLS LAST);

CREATE TABLE validator_commission
(
    validator_address   TEXT    NOT NULL REFERENCES validator_info (operator_address) ,
    commission          DECIMAL NOT NULL,
    min_self_delegation BIGINT  NOT NULL,
    height                BIGINT REFERENCES block (height)
);
CREATE INDEX validator_commission_height_index ON validator_commission (height DESC NULLS LAST);

CREATE TABLE validator_voting_power
(
    validator_address TEXT   NOT NULL REFERENCES validator_info (operator_address),
    delegator_shares numeric NOT NULL,
    voting_power      BIGINT NOT NULL,
    height            BIGINT REFERENCES block (height)
);
CREATE INDEX validator_voting_power_height_index ON validator_voting_power (height DESC NULLS LAST);

CREATE INDEX validator_voting_power_address_index ON validator_voting_power (validator_address);

CREATE TABLE validator_status
(
    validator_address TEXT    NOT NULL REFERENCES validator_info (operator_address),
    status            TEXT     NOT NULL,
    jailed            BOOLEAN NOT NULL,
    height                BIGINT REFERENCES block (height),

    PRIMARY KEY (validator_address, height)
);
CREATE INDEX validator_status_height_index ON validator_status (height DESC NULLS LAST);
CREATE INDEX validator_status_height_desc_null_lasts_index ON validator_status (height DESC NULLS LAST);
CREATE INDEX validator_status_address_index ON validator_status (validator_address);