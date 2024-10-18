import fs from "node:fs";
import path from "node:path";

import { BlockResultsResponse } from "@cosmjs/tendermint-rpc/build/tendermint34";
import { bus, DB, log, Utils } from "@eclesia/indexer";
import { Balance } from "cosmjs-types/cosmos/bank/v1beta1/genesis";

import { decreaseBalance, increaseBalance } from "./queries";
export type Events = {
  "genesis/array/app_state.bank.balances": { value: Balance };
};
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
  const db = DB.getInstance();
  const exists = await db.query(
    "SELECT EXISTS ( SELECT FROM pg_tables WHERE  schemaname = 'public' AND tablename  = 'balances')"
  );
  if (!exists.rows[0].exists) {
    try {
      const module = fs.readFileSync(__dirname + "/module.sql").toString();
      await db.query(module);
    } catch (e) {
      throw new Error("Could not init module bank: " + e);
    }
  }
  try {
    await migrate();
  } catch (_e) {
    throw new Error("Could not migrate module: " + name);
  }
};
export const name = "cosmos.bank.v1beta1";

function isTxResults(
  data:
    | BlockResultsResponse["beginBlockEvents"]
    | BlockResultsResponse["endBlockEvents"]
    | BlockResultsResponse["results"]
): data is BlockResultsResponse["results"] {
  if (data.length > 0) {
    return (data as BlockResultsResponse["results"])[0].events !== undefined;
  } else {
    return false;
  }
}

const eventHandler = async (data: {
  value:
    | BlockResultsResponse["beginBlockEvents"]
    | BlockResultsResponse["endBlockEvents"]
    | BlockResultsResponse["results"];
  height?: number;
  uuid?: string;
}) => {
  let events: BlockResultsResponse["endBlockEvents"];
  if (isTxResults(data.value)) {
    events = data.value.map((x) => x.events).flat();
  } else {
    events = data.value;
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.type == "coin_spent") {
      let spender: string | undefined;
      let amount: string | undefined;
      for (let j = 0; j < event.attributes.length; j++) {
        const key = Utils.decodeAttr(event.attributes[j].key);
        const value = Utils.decodeAttr(event.attributes[j].value);
        if (key == "spender") {
          spender = value;
        }
        if (key == "amount") {
          amount = value;
        }
      }
      if (spender && amount) {
        await decreaseBalance(spender, amount, data.height);
      }
    }
    if (event.type == "burn") {
      let spender: string | undefined;
      let amount: string | undefined;
      for (let j = 0; j < event.attributes.length; j++) {
        const key = Utils.decodeAttr(event.attributes[j].key);
        const value = Utils.decodeAttr(event.attributes[j].value);
        if (key == "burner") {
          spender = value;
        }
        if (key == "amount") {
          amount = value;
        }
      }
      if (spender && amount) {
        await decreaseBalance(spender, amount, data.height);
      }
    }
    if (event.type == "coin_received") {
      let receiver: string | undefined;
      let amount: string | undefined;
      for (let j = 0; j < event.attributes.length; j++) {
        const key = Utils.decodeAttr(event.attributes[j].key);
        const value = Utils.decodeAttr(event.attributes[j].value);
        if (key == "receiver") {
          receiver = value;
        }
        if (key == "amount") {
          amount = value;
        }
      }
      if (receiver && amount) {
        await increaseBalance(receiver, amount, data.height);
      }
    }
    if (event.type == "coinbase") {
      let receiver: string | undefined;
      let amount: string | undefined;
      for (let j = 0; j < event.attributes.length; j++) {
        const key = Utils.decodeAttr(event.attributes[j].key);
        const value = Utils.decodeAttr(event.attributes[j].value);
        if (key == "minter") {
          receiver = value;
        }
        if (key == "amount") {
          amount = value;
        }
      }
      if (receiver && amount) {
        await increaseBalance(receiver, amount, data.height);
      }
    }
  }
  if (data.uuid) {
    bus.emit("uuid", { status: true, uuid: data.uuid });
  }
};
export const init = async () => {
  await setupDB();
  bus.on("genesis/array/app_state.bank.balances", async (event) => {
    const db = DB.getInstance();
    await db.query({
      name: "save-genesis-balance",
      text: "INSERT INTO balances(address,coins) VALUES ($1,$2::COIN[])",
      values: [
        event.value.address,
        event.value.coins.map((x) => {
          return '("' + x.denom + '", "' + x.amount + '")';
        }),
      ],
    });
    if (event.uuid) {
      bus.emit("uuid", { status: true, uuid: event.uuid });
    }
  });
  bus.on("begin_block", async (data) => {
    return await eventHandler({
      value: data.value.events,
      height: data.height,
      uuid: data.uuid,
    });
  });
  bus.on("tx_events", eventHandler);
  bus.on("end_block", eventHandler);
};
export const depends = ["cosmos.auth.v1beta1"];
export const provides = [name];
