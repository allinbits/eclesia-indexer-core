/* ---- VALIDATORS INFO ---- */

/* Operator-level static info. One row per validator, keyed by operator_address
   (which never changes across a consensus-key rotation). Referenced by the
   description/commission/voting-power/status tables. */
CREATE TABLE validator_infos
(
    operator_address      TEXT   NOT NULL UNIQUE,
    self_delegate_address TEXT REFERENCES accounts (address),
    max_change_rate       TEXT   NOT NULL,
    max_rate              TEXT   NOT NULL,
    height                BIGINT REFERENCES blocks (height)
);
CREATE INDEX validator_info_operator_address_index ON validator_infos (operator_address);
CREATE INDEX validator_info_self_delegate_address_index ON validator_infos (self_delegate_address);

/* ---- VALIDATORS (consensus keys) ---- */

/* One row per consensus key a validator has ever used. On a MsgRotateConsPubKey
   the previous row is flipped to is_active=false and a new row is appended, so
   this table doubles as the historical operator<->consensus mapping (an old
   block's proposer_address still resolves here to its operator). */
CREATE TABLE validators
(
    consensus_address TEXT    NOT NULL PRIMARY KEY, /* Validator consensus address */
    consensus_pubkey  TEXT    NOT NULL UNIQUE, /* Validator consensus public key */
    operator_address  TEXT    NOT NULL REFERENCES validator_infos (operator_address),
    is_active         BOOLEAN NOT NULL DEFAULT TRUE, /* Whether this is the validator's current consensus key */
    height            BIGINT  REFERENCES blocks (height) /* Height at which this key became active */
);
/* At most one active consensus key per operator */
CREATE UNIQUE INDEX validators_active_operator_idx ON validators (operator_address) WHERE is_active;
CREATE INDEX validators_operator_address_index ON validators (operator_address);
ALTER TABLE blocks ADD CONSTRAINT block_validator_fkey FOREIGN KEY(proposer_address) REFERENCES validators(consensus_address);

/* ---- PARAMS ---- */
CREATE TABLE staking_params
(

    params     JSONB   NOT NULL,
    height     BIGINT

);
CREATE INDEX staking_params_height_index ON staking_params (height DESC NULLS LAST);

CREATE TABLE staked_balances
(
    delegator TEXT             REFERENCES accounts (address),
    shares numeric NOT NULL,
    amount COIN NOT NULL,
    validator TEXT REFERENCES validators(consensus_address),
    height                   BIGINT REFERENCES blocks (height)
);
CREATE INDEX staked_balances_height_index ON staked_balances (height DESC NULLS LAST);
CREATE INDEX staked_balances_delegator_index ON staked_balances (delegator);
CREATE INDEX staked_balances_validator_index ON staked_balances (validator);
CREATE INDEX staked_balances_lookup_index ON staked_balances (delegator, validator, height);
/* ---- POOL ---- */
CREATE TABLE staking_pool
(

    bonded_tokens            TEXT    NOT NULL,
    not_bonded_tokens        TEXT    NOT NULL,
    height                   BIGINT,
    CONSTRAINT unique_pool UNIQUE (bonded_tokens, not_bonded_tokens)

);
CREATE INDEX staking_pool_height_index ON staking_pool (height DESC NULLS LAST);

CREATE TABLE validator_descriptions
(
    validator_address TEXT   NOT NULL REFERENCES validator_infos (operator_address) ,
    moniker           TEXT,
    identity          TEXT,
    avatar_url        TEXT,
    website           TEXT,
    security_contact  TEXT,
    details           TEXT,
    height                BIGINT REFERENCES blocks (height)
);
CREATE INDEX validator_description_height_index ON validator_descriptions (height DESC NULLS LAST);

CREATE TABLE validator_commissions
(
    validator_address   TEXT    NOT NULL REFERENCES validator_infos (operator_address) ,
    commission          DECIMAL NOT NULL,
    min_self_delegation BIGINT  NOT NULL,
    height                BIGINT REFERENCES blocks (height)
);
CREATE INDEX validator_commission_height_index ON validator_commissions (height DESC NULLS LAST);

CREATE TABLE validator_voting_powers
(
    validator_address TEXT   NOT NULL REFERENCES validator_infos (operator_address),
    delegator_shares numeric NOT NULL,
    voting_power      BIGINT NOT NULL,
    height            BIGINT REFERENCES blocks (height)
);
CREATE INDEX validator_voting_power_height_index ON validator_voting_powers (height DESC NULLS LAST);

CREATE INDEX validator_voting_power_address_index ON validator_voting_powers (validator_address);

CREATE TABLE validator_status
(
    validator_address TEXT    NOT NULL REFERENCES validator_infos (operator_address),
    status            TEXT     NOT NULL,
    jailed            BOOLEAN NOT NULL,
    height                BIGINT REFERENCES blocks (height),

    PRIMARY KEY (validator_address, height)
);
CREATE INDEX validator_status_height_index ON validator_status (height DESC NULLS LAST);
CREATE INDEX validator_status_height_desc_null_lasts_index ON validator_status (height DESC NULLS LAST);
CREATE INDEX validator_status_address_index ON validator_status (validator_address);
