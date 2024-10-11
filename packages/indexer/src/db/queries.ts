import pg from "pg";

import { getInstance } from ".";

const connectionString = process.env.PG_CONNECTION_STRING;

const assertAccount = async (address: string) => {
  const db = getInstance();
  const res = await db.query("SELECT address from account WHERE address=$1", [
    address,
  ]);
  if (res.rowCount == 0) {
    await db.query("INSERT INTO account(address) values($1)", [address]);
  }
};

const getNextHeight = async () => {
  const { Client } = pg;
  const client = new Client(connectionString);
  await client.connect();
  try {
    const res = await client.query(
      "SELECT * FROM block ORDER BY height DESC LIMIT 1"
    );
    if (res.rowCount == 0) {
      return Number(process.env.CHAIN_START_HEIGHT);
    } else {
      return Number(res.rows[0].height) + 1;
    }
  } catch (_e) {
    throw new Error("Error reading from DB");
  } finally {
    client.end();
  }
};
const getUnbondingHeight = async (
  height: bigint,
  unbondingPeriod: number
): Promise<bigint> => {
  const db = getInstance();
  const timestamp = await db.query("SELECT * FROM block WHERE height=$1", [
    height,
  ]);
  if (timestamp.rowCount && timestamp.rowCount > 0) {
    const date = new Date(timestamp.rows[0].timestamp);
    const unbondingTime = new Date(date.getTime() - unbondingPeriod);
    const unbondingHeight = await db.query(
      "SELECT * FROM block WHERE timestamp<=$1 ORDER BY height desc LIMIT 1",
      [unbondingTime]
    );
    if (unbondingHeight.rowCount && unbondingHeight.rowCount > 0) {
      return BigInt(unbondingHeight.rows[0].height);
    } else {
      return 1n;
    }
  } else {
    throw new Error("Invalid block height");
  }
};
export { assertAccount, getNextHeight, getUnbondingHeight };
