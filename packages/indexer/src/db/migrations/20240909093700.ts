import pg from "pg";

export const run = async (_db: pg.Client) => {
  console.log("Migration successful: " + __filename);
};
