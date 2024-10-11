import pg from "pg";

export const run = async (db: pg.Client) => {
  console.log("Migration successful: " + __filename);
};
