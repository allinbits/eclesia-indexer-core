import { atomoneProtoRegistry } from "@atomone/atomone-types/atomone/client";
import { cosmosProtoRegistry } from "@atomone/atomone-types/cosmos/client";
import { TxData } from "@cosmjs/tendermint-rpc/build/tendermint34";
import { DB, Utils } from "@eclesia/indexer";
import { Tx } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import JSONbig from "json-bigint";

const registry = cosmosProtoRegistry.concat(atomoneProtoRegistry);
const registryMap: Map<string, (typeof registry)[0][1]> = new Map();
for (let i = 0; i < registry.length; i++) {
  registryMap.set(registry[i][0], registry[i][1]);
}
const getBlockHeightTime = async (dt: Date) => {
  const db = DB.getInstance();
  const block = await db.query(
    "SELECT * FROM block WHERE block.timestamp <= $1 ORDER BY block.timestamp DESC LIMIT 1;",
    [dt]
  );
  if (block.rowCount && block.rowCount > 0) {
    return block.rows[0];
  } else {
    return null;
  }
};
const getBlockHeightTimeMinuteAgo = async (dt: string) => {
  const date = new Date(dt);
  const aMinuteAgo = new Date(date.getTime() - 60 * 1000);

  return await getBlockHeightTime(aMinuteAgo);
};
const getBlockHeightTimeHourAgo = async (dt: string) => {
  const date = new Date(dt);
  const anHourAgo = new Date(date.getTime() - 60 * 60 * 1000);

  return await getBlockHeightTime(anHourAgo);
};
const getBlockHeightTimeDayAgo = async (dt: string) => {
  const date = new Date(dt);
  const aDayAgo = new Date(date.getTime() - 24 * 60 * 60 * 1000);

  return await getBlockHeightTime(aDayAgo);
};
const updateBlockTimeMinuteAgo = async (blocktime: number, height: number) => {
  const db = DB.getInstance();
  await db.query(
    "INSERT INTO average_block_time_per_minute(average_time, height) VALUES ($1, $2) ON CONFLICT (one_row_id) DO UPDATE SET average_time = excluded.average_time, height = excluded.height WHERE average_block_time_per_minute.height <= excluded.height",
    [blocktime, height]
  );
};
const updateBlockTimeHourAgo = async (blocktime: number, height: number) => {
  const db = DB.getInstance();
  await db.query(
    "INSERT INTO average_block_time_per_hour(average_time, height) VALUES ($1, $2) ON CONFLICT (one_row_id) DO UPDATE SET average_time = excluded.average_time, height = excluded.height WHERE average_block_time_per_hour.height <= excluded.height",
    [blocktime, height]
  );
};
const updateBlockTimeDayAgo = async (blocktime: number, height: number) => {
  const db = DB.getInstance();
  await db.query(
    "INSERT INTO average_block_time_per_day(average_time, height) VALUES ($1, $2) ON CONFLICT (one_row_id) DO UPDATE SET average_time = excluded.average_time, height = excluded.height WHERE average_block_time_per_day.height <= excluded.height",
    [blocktime, height]
  );
};
const saveTransaction = async (
  txHash: string,
  height: number,
  tx: Tx,
  txdata: TxData
) => {
  const db = DB.getInstance();
  await db.query({
    name: "add-tx",
    text: "INSERT INTO transaction(hash,height,success,messages,memo,signatures,signer_infos,fee,gas_wanted,gas_used,raw_log,logs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
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
      JSON.stringify(Utils.toPlainObject(txdata.events)),
    ],
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
  updateBlockTimeMinuteAgo,
};
