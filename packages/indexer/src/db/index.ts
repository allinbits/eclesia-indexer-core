import fs from "node:fs";
import path from "node:path";

import pg from "pg";

import { log } from "../bus";

const connectionString = process.env.PG_CONNECTION_STRING;

const { Client } = pg;

const instance = new Client(connectionString);

let instanceConnected = false;
instance.on("end", () => {
  instanceConnected = false;
});
export const checkHealth = async () => {
  try {
    const client = new Client(connectionString);
    await client.connect();
    await client.end();

    return "OK";
  } catch (_e) {
    return "FAILED";
  }
};

//migrate creates the necessary table schema to holdf migration data (if prior to migration support) and then runs the migration scripts for the core module
const migrate = async () => {
  const client = new Client(connectionString);
  await client.connect();
  try {
    // If versions for migration support does not exist create it
    const exists = await client.query(
      "SELECT EXISTS ( SELECT FROM pg_tables WHERE  schemaname = 'public' AND tablename  = 'migrations')"
    );
    if (!exists.rows[0].exists) {
      const moduleSql = fs
        .readFileSync(__dirname + "/core-migrations.sql")
        .toString();
      await client.query(moduleSql);
    }
  } catch (e) {
    throw new Error("Could not upgrade DB: " + e);
  }
  const latestMigrationQuery = await client.query(
    "SELECT * FROM migrations WHERE module='core' ORDER BY dt DESC LIMIT 1"
  );
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
        await migration.run(client);
        await client.query(
          "INSERT INTO migrations(module,dt) VALUES ($1,$2);",
          ["core", dt]
        );
      }
    }
  }
};

//setup creates the minimum necessary table schema for the db
const setup = async () => {
  const client = new Client(connectionString);
  const base = fs.readFileSync(__dirname + "/../sql/base.sql").toString();
  let mustParseGenesis: boolean = false;
  await client.connect();

  const exists = await client.query(
    "SELECT EXISTS ( SELECT FROM pg_tables WHERE  schemaname = 'public' AND tablename  = 'block')"
  );

  if (!exists.rows[0].exists) {
    log.warning("Database not configured");

    try {
      await client.query(base);
      log.info("DB has been set up");
      mustParseGenesis = true;
    } catch (e) {
      throw new Error("" + e);
    } finally {
      client.end();
    }
  }
  await migrate();

  return mustParseGenesis;
};

const beginTransaction = async () => {
  if (!instanceConnected) {
    await instance.connect();
    instanceConnected = true;
  }
  await instance.query("BEGIN");

  return instance;
};

const endTransaction = async (status: boolean) => {
  if (status) {
    await instance.query("COMMIT");
  } else {
    await instance.query("ROLLBACK");
  }
};

const getInstance = () => {
  return instance;
};

export { beginTransaction, endTransaction, getInstance, setup };
