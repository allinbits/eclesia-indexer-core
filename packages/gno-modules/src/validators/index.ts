import * as path from "node:path";
import {
  fileURLToPath,
} from "node:url";

import {
  loadMigrations, PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  GnoAdapter,
} from "@eclesia/chain-gno";
import {
  EclesiaIndexer, Types,
} from "@eclesia/indexer-engine";

import {
  gnoAddress, jsonStringify,
} from "../helpers.js";

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Validators module for gno.land: tracks the validator set block by block, recording every
 * validator, its voting power, when it was first and last seen, and each change of power as
 * history. Needs full indexing mode (`minimal: false`), which fetches the set per block.
 */
export class ValidatorsModule implements Types.IndexingModule<GnoAdapter> {
  indexer!: EclesiaIndexer<GnoAdapter>;

  private pgIndexer!: PgIndexer<GnoAdapter>;

  private warnedMinimal = false;

  public name: string = "gno.validators";

  public depends: string[] = [];

  public provides: string[] = ["gno.validators"];

  async setup() {
    await this.pgIndexer.applyMigrations(this.name, loadMigrations(path.join(__dirname, "sql")), "validators");
  }

  init(pgIndexer: PgIndexer<GnoAdapter>): void {
    this.pgIndexer = pgIndexer;
    this.indexer = pgIndexer.indexer;

    this.indexer.on("block", async (event) => {
      const validators = event.value.validators;
      if (!validators) {
        if (!this.warnedMinimal) {
          this.warnedMinimal = true;
          this.indexer.log.warn("gno.validators needs the validator set, which is only fetched with minimal: false; nothing will be recorded");
        }
        return;
      }
      await this.reconcile(validators, event.height!);
    });
  }

  /**
   * Diffs the observed set against the active rows. The active rows are read per block rather
   * than cached, so a rolled-back block cannot leave the module believing in writes that never
   * committed; validator sets are small enough for that to be cheap.
   */
  private async reconcile(validators: readonly {
    address: Uint8Array
    pubkey?: unknown
    votingPower: bigint
  }[], height: number): Promise<void> {
    const db = this.pgIndexer.getInstance();
    const endTimer = this.indexer.prometheus?.timeDatabaseQuery("reconcile-validators") ?? void 0;
    const active = await db.query("SELECT address, voting_power FROM validators WHERE active");
    const known = new Map<string, bigint>(active.rows.map(row => [row.address as string, BigInt(row.voting_power)]));

    const seen: string[] = [];
    for (const validator of validators) {
      const address = gnoAddress(validator.address);
      seen.push(address);
      const previous = known.get(address);
      if (previous === undefined) {
        await db.query({
          name: "upsert-validator",
          text: "INSERT INTO validators(address, pubkey, voting_power, active, first_seen_height, last_seen_height) VALUES ($1,$2,$3,TRUE,$4,$4) "
            + "ON CONFLICT (address) DO UPDATE SET pubkey = EXCLUDED.pubkey, voting_power = EXCLUDED.voting_power, active = TRUE, last_seen_height = EXCLUDED.last_seen_height",
          values: [address, validator.pubkey ? jsonStringify(validator.pubkey) : null, validator.votingPower.toString(), height],
        });
        await this.history(address, height, validator.votingPower);
      }
      else if (previous !== validator.votingPower) {
        await db.query({
          name: "update-validator-power",
          text: "UPDATE validators SET voting_power = $2 WHERE address = $1",
          values: [address, validator.votingPower.toString()],
        });
        await this.history(address, height, validator.votingPower);
      }
    }
    if (seen.length > 0) {
      await db.query({
        name: "touch-validators",
        text: "UPDATE validators SET last_seen_height = $2 WHERE address = ANY($1::text[])",
        values: [seen, height],
      });
    }
    for (const address of known.keys()) {
      if (!seen.includes(address)) {
        await db.query({
          name: "deactivate-validator",
          text: "UPDATE validators SET active = FALSE WHERE address = $1",
          values: [address],
        });
        await this.history(address, height, 0n);
      }
    }
    endTimer?.();
  }

  private async history(address: string, height: number, power: bigint): Promise<void> {
    await this.pgIndexer.getInstance().query({
      name: "add-validator-power",
      text: "INSERT INTO validator_power_history(address, height, voting_power) VALUES ($1,$2,$3) ON CONFLICT (address, height) DO UPDATE SET voting_power = EXCLUDED.voting_power",
      values: [address, height, power.toString()],
    });
  }
}
