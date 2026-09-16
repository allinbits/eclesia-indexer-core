import {
  PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  GnoAdapter,
} from "@eclesia/chain-gno";

type Db = ReturnType<PgIndexer<GnoAdapter>["getInstance"]>;

const WINDOWS = [
  {
    table: "average_block_time_per_minute",
    ms: 60 * 1000,
    metric: "update-blocktime-minute",
  },
  {
    table: "average_block_time_per_hour",
    ms: 60 * 60 * 1000,
    metric: "update-blocktime-hour",
  },
  {
    table: "average_block_time_per_day",
    ms: 24 * 60 * 60 * 1000,
    metric: "update-blocktime-day",
  },
] as const;

/**
 * Maintains the average block time over the last minute, hour and day in three single-row
 * tables, from the heights and times already stored in `blocks`. Called from the periodic
 * handler of the full blocks module.
 */
export class BlockTimeAverages {
  constructor(private readonly pgIndexer: PgIndexer<GnoAdapter>) {}

  /** Most recent block at or before an instant */
  private async blockAtOrBefore(db: Db, at: Date): Promise<{
    height: number
    timestamp: string
  } | null> {
    const endTimer = this.pgIndexer.indexer.prometheus?.timeDatabaseQuery("get-block-height") ?? void 0;
    const block = await db.query("SELECT height, timestamp FROM blocks WHERE blocks.timestamp <= $1 ORDER BY blocks.timestamp DESC LIMIT 1;", [at]);
    endTimer?.();
    return block.rowCount ? block.rows[0] : null;
  }

  /**
   * Recomputes the three averages from the block at `height` with time `timestamp`.
   * @param height - Current block height
   * @param timestamp - Current block time (RFC 3339)
   */
  async update(height: number, timestamp: string): Promise<void> {
    const db = this.pgIndexer.getInstance();
    const now = new Date(timestamp);
    for (const window of WINDOWS) {
      const earlier = await this.blockAtOrBefore(db, new Date(now.getTime() - window.ms));
      if (!earlier || Number(earlier.height) >= height) {
        continue;
      }
      const elapsedMs = now.getTime() - new Date(earlier.timestamp).getTime();
      if (elapsedMs <= 0) {
        continue;
      }
      // Seconds per block over the window
      const average = elapsedMs / 1000 / (height - Number(earlier.height));
      const endTimer = this.pgIndexer.indexer.prometheus?.timeDatabaseQuery(window.metric) ?? void 0;
      await db.query(
        "INSERT INTO " + window.table + "(average_time, height) VALUES ($1, $2) ON CONFLICT (one_row_id) DO UPDATE SET average_time = excluded.average_time, height = excluded.height WHERE " + window.table + ".height <= excluded.height",
        [average, height],
      );
      endTimer?.();
    }
  }
}
