-- One staked balance row per (delegator, validator, height). Two staking messages for the same pair
-- in one block used to write two rows at the same height, and the next "latest row" lookup
-- (ORDER BY height DESC LIMIT 1) returned either of them, so later updates could build on the
-- earlier, stale row and the error carried forward from then on. Writes now upsert on this key.
--
-- Existing duplicates: keep the row written last. The table is append-only (no UPDATE or DELETE
-- before this migration), so physical order is insertion order. The rows kept here can still be
-- wrong for pairs that already drifted; those need re-syncing against the chain.
DELETE FROM staked_balances
WHERE ctid IN (
    SELECT ctid FROM (
        SELECT ctid, row_number() OVER (PARTITION BY delegator, validator, height ORDER BY ctid DESC) AS n
        FROM staked_balances
        WHERE height IS NOT NULL
    ) ranked
    WHERE n > 1
);

-- Genesis rows keep a NULL height, which stays distinct under this constraint
ALTER TABLE staked_balances ADD CONSTRAINT unique_staked_balance_height UNIQUE (delegator, validator, height);

-- Same columns as the new constraint's index
DROP INDEX IF EXISTS staked_balances_lookup_index;
