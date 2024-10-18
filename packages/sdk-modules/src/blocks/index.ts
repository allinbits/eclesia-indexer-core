import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { bus, DB, log, Utils } from "@eclesia/indexer";
import { Tx } from "cosmjs-types/cosmos/tx/v1beta1/tx";

import { calculateGas } from "./helpers";
import {
  getBlockHeightTimeDayAgo,
  getBlockHeightTimeHourAgo,
  getBlockHeightTimeMinuteAgo,
  saveTransaction,
  updateBlockTimeDayAgo,
  updateBlockTimeHourAgo,
  updateBlockTimeMinuteAgo,
} from "./queries";

const migrate = async () => {
  const client = await DB.getInstance();
  try {
    const latestMigrationQuery = await client.query(
      "SELECT * FROM migrations WHERE module=$1 ORDER BY dt DESC LIMIT 1",
      [name]
    );
    if (fs.existsSync(__dirname + "/migrations")) {
      const latestMigration =
        latestMigrationQuery.rowCount && latestMigrationQuery.rowCount > 0
          ? latestMigrationQuery.rows[0].dt
          : "0";
      const files = fs.readdirSync(__dirname + "/migrations").sort();
      for (let i = 0; i < files.length; i++) {
        if (path.extname(files[i]) == ".js") {
          const dt = path.basename(files[i], ".js");
          if (Number(dt) > Number(latestMigration)) {
            const migrationPath = __dirname + "/migrations/" + files[i];
            const migration = await import(migrationPath);
            log.info("Running migration: (" + name + ") " + migrationPath);
            await migration.run(client);
            await client.query(
              "INSERT INTO migrations(module,dt) VALUES ($1,$2);",
              [name, dt]
            );
          }
        }
      }
    }
  } catch (e) {
    log.error("" + e);
    throw e;
  }
};
const setupDB = async () => {
  try {
    await migrate();
  } catch (_e) {
    throw new Error("Could not migrate module: " + name);
  }
};
export const init = async () => {
  await setupDB();
  bus.on("block", async (event): Promise<void> => {
    const block = event.value.block;
    const block_results = event.value.block_results;
    const db = DB.getInstance();
    db.query({
      name: "add-block",
      text: "INSERT INTO block(height,hash,num_txs,total_gas, proposer_address, timestamp) VALUES ($1,$2,$3,$4,$5,$6)",
      values: [
        block.block.header.height,
        Buffer.from(block.blockId.hash).toString("hex"),
        block.block.txs.length,
        calculateGas(block_results).toString(),
        Utils.chainAddressfromKeyhash(
          (process.env.CHAIN_PREFIX ?? "cosmos") + "valcons",
          Buffer.from(block.block.header.proposerAddress).toString("hex")
        ),
        block.block.header.time,
      ],
    });
    for (let i = 0; i < block.block.txs.length; i++) {
      const txraw = block.block.txs[i];
      const tx = Tx.decode(txraw);
      const txHash = createHash("sha256").update(txraw).digest("hex");
      if (event.height) {
        saveTransaction(txHash, event.height, tx, block_results.results[i]);
      }
    }
    log.verbose("Value passed to blocks indexing module: " + event.value);
    if (event.uuid) {
      bus.emit("uuid", { status: true, uuid: event.uuid });
    }
  });

  bus.on("periodic/100", async (event) => {
    if (event.timestamp && event.height) {
      const dt = new Date(event.timestamp);
      const blockMinAgo = await getBlockHeightTimeMinuteAgo(event.timestamp);
      if (blockMinAgo) {
        const blockTimeMinute =
          ((event.height - blockMinAgo.height) * 1000) /
          (dt.getTime() - new Date(blockMinAgo.timestamp).getTime());
        await updateBlockTimeMinuteAgo(1 / blockTimeMinute, event.height);
      }
      const blockHourAgo = await getBlockHeightTimeHourAgo(event.timestamp);
      if (blockHourAgo) {
        const blockTimeHour =
          ((event.height - blockHourAgo.height) * 1000) /
          (dt.getTime() - new Date(blockHourAgo.timestamp).getTime());
        await updateBlockTimeHourAgo(1 / blockTimeHour, event.height);
      }
      const blockDayAgo = await getBlockHeightTimeDayAgo(event.timestamp);
      if (blockDayAgo) {
        const blockTimeDay =
          ((event.height - blockDayAgo.height) * 1000) /
          (dt.getTime() - new Date(blockDayAgo.timestamp).getTime());
        await updateBlockTimeDayAgo(1 / blockTimeDay, event.height);
      }
    }
    if (event.uuid) {
      bus.emit("uuid", { status: true, uuid: event.uuid });
    }
  });
};
export const name = "blocks";
export const depends: string[] = [];
export const provides = ["blocks"];
