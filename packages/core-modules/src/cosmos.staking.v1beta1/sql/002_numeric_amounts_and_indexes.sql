-- Token amounts on 18-decimal chains overflow BIGINT (a validator with 10M tokens is 1e25)
ALTER TABLE validator_voting_powers ALTER COLUMN voting_power TYPE NUMERIC USING voting_power::NUMERIC;
ALTER TABLE validator_commissions ALTER COLUMN min_self_delegation TYPE NUMERIC USING min_self_delegation::NUMERIC;

-- One pool snapshot per height. The old constraint was on the token values, so a new height was
-- silently dropped whenever the pool returned to a previously seen pair of values.
ALTER TABLE staking_pool DROP CONSTRAINT unique_pool;
ALTER TABLE staking_pool ADD CONSTRAINT unique_pool UNIQUE (height);

-- Latest-row lookups by validator (ORDER BY height DESC NULLS LAST LIMIT 1)
CREATE INDEX IF NOT EXISTS validator_description_lookup_index ON validator_descriptions (validator_address, height DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS validator_commission_lookup_index ON validator_commissions (validator_address, height DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS validator_voting_power_lookup_index ON validator_voting_powers (validator_address, height DESC NULLS LAST);

-- Identical to validator_status_height_index
DROP INDEX IF EXISTS validator_status_height_desc_null_lasts_index;
