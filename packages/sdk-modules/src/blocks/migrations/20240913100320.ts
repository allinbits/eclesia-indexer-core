import { GeneratedType } from "@cosmjs/proto-signing";
import { Any } from "cosmjs-types/google/protobuf/any";
import JSONbig from "json-bigint";
import pg from "pg";

export const run = async (
  db: pg.Client,
  registryMap: Map<string, GeneratedType>
) => {
  try {
    const txs = await db.query("SELECT * from transaction");
    if (txs.rowCount) {
      for (let i = 0; i < txs.rowCount; i++) {
        if (
          txs.rows[i].messages &&
          txs.rows[i].messages.length > 0 &&
          txs.rows[i].messages[0].typeUrl
        ) {
          const decoded = (txs.rows[i].messages as Any[]).map((x) => {
            const msgtype = registryMap.get(x.typeUrl);
            if (msgtype) {
              const msg = msgtype.decode(
                new Uint8Array(Object.values(x.value))
              );
              msg["@type"] = x.typeUrl;

              return msg;
            } else {
              return x;
            }
          });
          await db.query("UPDATE transaction SET messages = $1 WHERE hash=$2", [
            JSONbig.stringify(decoded),
            txs.rows[i].hash,
          ]);
        }
      }
    }
  } catch (e) {
    console.log("Migration failed (" + __filename + "): " + e);
  }
};
