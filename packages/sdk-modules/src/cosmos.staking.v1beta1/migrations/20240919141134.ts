import pg from "pg";

// Add additional imports here

export const run = async (db: pg.Client) => {
  try {
    const sql = `
    ALTER TABLE validator_voting_power ADD COLUMN delegator_shares numeric NOT NULL DEFAULT 0;
    ALTER TABLE staked_balances ADD COLUMN shares numeric NOT NULL DEFAULT 0;
    UPDATE staked_balances SET shares=CAST((amount).amount as numeric);
    UPDATE validator_voting_power SET delegator_shares=voting_power;
    ALTER TABLE validator_voting_power ALTER COLUMN delegator_shares DROP DEFAULT;
    ALTER TABLE staked_balances ALTER COLUMN shares DROP DEFAULT;
    `; // Add necessary SQL here
    await db.query(sql);

    // additional processing here
  } catch (e) {
    console.log("Migration failed (" + __filename + "): " + e);
  }
};
