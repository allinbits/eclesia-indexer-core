import { GeneratedType } from "@cosmjs/proto-signing";
import { TxData } from "@cosmjs/tendermint-rpc";
import { Utils } from "@eclesia/indexer-engine";
import { Tx } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import JSONbig from "json-bigint";
import { Client } from "pg";

const getBlockHeightTime = async(db: Client, dt: Date) => {
  const block = await db.query(
    "SELECT * FROM blocks WHERE block.timestamp <= $1 ORDER BY block.timestamp DESC LIMIT 1;", [dt]
  );
  if (block.rowCount && block.rowCount > 0) {
    return block.rows[0];
  } else {
    return null;
  }
};
const getBlockHeightTimeMinuteAgo = async(db: Client, dt: string) => {
  const date = new Date(dt);
  const aMinuteAgo = new Date(date.getTime() - 60 * 1000);

  return await getBlockHeightTime(db, aMinuteAgo);
};
const getBlockHeightTimeHourAgo = async(db: Client, dt: string) => {
  const date = new Date(dt);
  const anHourAgo = new Date(date.getTime() - 60 * 60 * 1000);

  return await getBlockHeightTime(db, anHourAgo);
};
const getBlockHeightTimeDayAgo = async(db: Client, dt: string) => {
  const date = new Date(dt);
  const aDayAgo = new Date(date.getTime() - 24 * 60 * 60 * 1000);

  return await getBlockHeightTime(db, aDayAgo);
};
const updateBlockTimeMinuteAgo = async(db: Client, blocktime: number, height: number) => {
  
  await db.query(
    "INSERT INTO average_block_time_per_minute(average_time, height) VALUES ($1, $2) ON CONFLICT (one_row_id) DO UPDATE SET average_time = excluded.average_time, height = excluded.height WHERE average_block_time_per_minute.height <= excluded.height", [blocktime, height]
  );
};
const updateBlockTimeHourAgo = async(db: Client, blocktime: number, height: number) => {
  
  await db.query(
    "INSERT INTO average_block_time_per_hour(average_time, height) VALUES ($1, $2) ON CONFLICT (one_row_id) DO UPDATE SET average_time = excluded.average_time, height = excluded.height WHERE average_block_time_per_hour.height <= excluded.height", [blocktime, height]
  );
};
const updateBlockTimeDayAgo = async(db: Client, blocktime: number, height: number) => {
  
  await db.query(
    "INSERT INTO average_block_time_per_day(average_time, height) VALUES ($1, $2) ON CONFLICT (one_row_id) DO UPDATE SET average_time = excluded.average_time, height = excluded.height WHERE average_block_time_per_day.height <= excluded.height", [blocktime, height]
  );
};
const saveTransaction = async(
  db: Client, 
  txHash: string,
  height: number,
  tx: Tx,
  txdata: TxData,
  registryMap: Map<string, GeneratedType>
) => {
  await db.query({
    name: "add-tx",
    text: "INSERT INTO transactions(hash,height,success,messages,memo,signatures,signer_infos,fee,gas_wanted,gas_used,raw_log,logs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    values: [
      txHash.toUpperCase(),
      height,
      txdata.code == 0,
      JSONbig.stringify(
        tx.body?.messages.map((x) => {
          const msgtype = registryMap.get(x.typeUrl);
          if (msgtype) {
            const msg = msgtype?.decode(x.value);
            msg["@type"] = x.typeUrl;

            return msg;
          } else {
            return x;
          }
        })
      ),
      tx.body?.memo,
      tx.signatures,
      JSON.stringify(Utils.toPlainObject(tx.authInfo?.signerInfos)),
      JSON.stringify(Utils.toPlainObject(tx.authInfo?.fee)),
      txdata.gasWanted,
      txdata.gasUsed,
      txdata.log,
      JSON.stringify(Utils.toPlainObject(txdata.events))
    ]
  });
};
export {
  getBlockHeightTime,
  getBlockHeightTimeDayAgo,
  getBlockHeightTimeHourAgo,
  getBlockHeightTimeMinuteAgo,
  saveTransaction,
  updateBlockTimeDayAgo,
  updateBlockTimeHourAgo,
  updateBlockTimeMinuteAgo
};
