import pg from "pg";

import {
  getBlockHeightTimeDayAgo,
  getBlockHeightTimeHourAgo,
  getBlockHeightTimeMinuteAgo,
  updateBlockTimeDayAgo,
  updateBlockTimeHourAgo,
  updateBlockTimeMinuteAgo,
} from "../queries";

export const run = async (db: pg.Client) => {
  try {
    const sql = `
CREATE TABLE average_block_time_per_minute
(
    one_row_id   BOOL    NOT NULL DEFAULT TRUE PRIMARY KEY,
    average_time DECIMAL NOT NULL,
    height       BIGINT  NOT NULL,
    CHECK (one_row_id)
);
CREATE INDEX average_block_time_per_minute_height_index ON average_block_time_per_minute (height);

CREATE TABLE average_block_time_per_hour
(
    one_row_id   BOOL    NOT NULL DEFAULT TRUE PRIMARY KEY,
    average_time DECIMAL NOT NULL,
    height       BIGINT  NOT NULL,
    CHECK (one_row_id)
);
CREATE INDEX average_block_time_per_hour_height_index ON average_block_time_per_hour (height);

CREATE TABLE average_block_time_per_day
(
    one_row_id   BOOL    NOT NULL DEFAULT TRUE PRIMARY KEY,
    average_time DECIMAL NOT NULL,
    height       BIGINT  NOT NULL,
    CHECK (one_row_id)
);
CREATE INDEX average_block_time_per_day_height_index ON average_block_time_per_day (height);
`;
    await db.query(sql);
    const blocks = await db.query(
      "SELECT * from block ORDER BY height DESC LIMIT 1"
    );
    if (blocks.rowCount && blocks.rowCount > 0) {
      const blockMinAgo = await getBlockHeightTimeMinuteAgo(
        blocks.rows[0].timestamp
      );
      if (blockMinAgo) {
        const blockTimeMinute =
          ((blocks.rows[0].height - blockMinAgo.height) * 1000) /
          (blocks.rows[0].timestamp -
            new Date(blockMinAgo.timestamp).getTime());
        await updateBlockTimeMinuteAgo(
          1 / blockTimeMinute,
          blocks.rows[0].height
        );
      }
      const blockHourAgo = await getBlockHeightTimeHourAgo(
        blocks.rows[0].timestamp
      );
      if (blockHourAgo) {
        const blockTimeHour =
          ((blocks.rows[0].height - blockMinAgo.height) * 1000) /
          (blocks.rows[0].timestamp -
            new Date(blockHourAgo.timestamp).getTime());
        await updateBlockTimeHourAgo(1 / blockTimeHour, blocks.rows[0].height);
      }
      const blockDayAgo = await getBlockHeightTimeDayAgo(
        blocks.rows[0].timestamp
      );
      if (blockDayAgo) {
        const blockTimeDay =
          ((blocks.rows[0].height - blockMinAgo.height) * 1000) /
          (blocks.rows[0].timestamp -
            new Date(blockDayAgo.timestamp).getTime());
        await updateBlockTimeDayAgo(1 / blockTimeDay, blocks.rows[0].height);
      }
    }
  } catch (e) {
    console.log("Migration failed (" + __filename + "): " + e);
  }
};
