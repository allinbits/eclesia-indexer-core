/* eslint-disable max-lines-per-function */
import fs from "node:fs";
import path from "node:path";

import { asyncEmit, bus, DB, log } from "@eclesia/indexer";

import { getGenesisBalance } from "../cosmos.bank.v1beta1/queries";
import { getModuleAccount } from "./queries";
export type Events = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "genesis/array/app_state.auth.accounts": { value: any };
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
    "SELECT EXISTS ( SELECT FROM pg_tables WHERE  schemaname = 'public' AND tablename  = 'account')"
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
export const name = "cosmos.auth.v1beta1";

export const init = async (modules?: string[]) => {
  await setupDB();
  bus.on("block", async (event): Promise<void> => {
    try {
      if (event.value.block.block.header.height == 1) {
        /*
         Module accounts and module account balances are created/set during processing of gen txs.
         We have no events for those so we query/set them explicitly prior to processing block #1
        */
        const moduleAccounts: string[] = [];
        let acc = await getModuleAccount("fee_collector");
        if (acc) {
          moduleAccounts.push(acc);
        }
        acc = await getModuleAccount("inflation");
        if (acc) {
          moduleAccounts.push(acc);
        }
        acc = await getModuleAccount("transfer");
        if (acc) {
          moduleAccounts.push(acc);
        }
        acc = await getModuleAccount("mint");
        if (acc) {
          moduleAccounts.push(acc);
        }
        acc = await getModuleAccount("bonded_tokens_pool");
        if (acc) {
          moduleAccounts.push(acc);
        }
        acc = await getModuleAccount("not_bonded_tokens_pool");
        if (acc) {
          moduleAccounts.push(acc);
        }
        acc = await getModuleAccount("gov");
        if (acc) {
          moduleAccounts.push(acc);
        }
        acc = await getModuleAccount("distribution");
        if (acc) {
          moduleAccounts.push(acc);
        }
        acc = await getModuleAccount("ibc");
        if (acc) {
          moduleAccounts.push(acc);
        }
        for (let k = 0; k < moduleAccounts.length; k++) {
          await DB.assertAccount(moduleAccounts[k]);

          if (modules && modules.includes("cosmos.bank.v1beta1")) {
            const balance = await getGenesisBalance(moduleAccounts[k]);
            if (balance.length > 0) {
              await asyncEmit("genesis/array/app_state.bank.balances", {
                value: { address: moduleAccounts[k], coins: balance },
              });
            }
          }
        }
      }
      if (event.uuid) {
        bus.emit("uuid", { status: true, uuid: event.uuid });
      }
    } catch (_e) {
      if (event.uuid) {
        bus.emit("uuid", { status: false, uuid: event.uuid });
      }
    }
  });
  bus.on(
    "genesis/array/app_state.auth.accounts",
    async (event): Promise<void> => {
      switch (event.value["@type"]) {
        case "/cosmos.auth.v1beta1.ModuleAccount":
          await DB.assertAccount(event.value.base_account.address);
          break;
        case "/cosmos.vesting.v1beta1.DelayedVestingAccount":
          await DB.assertAccount(
            event.value.base_vesting_account.base_account.address
          );
          break;
        case "/cosmos.vesting.v1beta1.ContinuousVestingAccount":
          await DB.assertAccount(
            event.value.base_vesting_account.base_account.address
          );
          break;
        default:
        case "/cosmos.auth.v1beta1.BaseAccount":
          await DB.assertAccount(event.value.address);
          break;
      }
      if (event.uuid) {
        bus.emit("uuid", { status: true, uuid: event.uuid });
      }
    }
  );
};
export const depends: string[] = [];
export const provides = [name];
