import * as path from "node:path";
import {
  fileURLToPath,
} from "node:url";

import {
  loadMigrations, PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  GnoAdapter, parseCoins, parseGenesisBalance, parseTransferEvent,
} from "@eclesia/chain-gno";
import {
  EclesiaIndexer, Types,
} from "@eclesia/indexer-engine";
import type {
  Event,
} from "@gnolang/tm2-rpc";

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type BankModuleOptions = {
  /**
   * Addresses whose balance is re-read on every block that carries transactions, although no
   * event names them: the fee collector (auth params) and the storage and inert charge
   * collectors (vm params) receive coins without a transfer event.
   */
  trackAddresses?: string[]
  /** Read balances from the node for every touched address (default: true). Off keeps only transfers. */
  queryBalances?: boolean
};

/**
 * Bank module for gno.land. Records every transfer event, and keeps exact balances by asking
 * the node (`bank/balances/<address>` at the block's height) for every address a block
 * touched: transfer parties, signers of every transaction (fees are charged even when the
 * transaction fails) and the configured collectors. Fees and storage deposits move coins
 * without an event, which is why balances are read rather than derived. Genesis balances are
 * imported when genesis processing is on.
 */
export class BankModule implements Types.IndexingModule<GnoAdapter> {
  indexer!: EclesiaIndexer<GnoAdapter>;

  private pgIndexer!: PgIndexer<GnoAdapter>;

  private readonly trackAddresses: string[];

  private readonly queryBalances: boolean;

  /** Addresses touched by the block being processed */
  private touched = new Set<string>();

  private blockHasTxs = false;

  public name: string = "gno.bank";

  public depends: string[] = ["blocks"];

  public provides: string[] = ["gno.bank"];

  constructor(options: BankModuleOptions = {
  }) {
    this.trackAddresses = options.trackAddresses ?? [];
    this.queryBalances = options.queryBalances ?? true;
  }

  async setup() {
    await this.pgIndexer.applyMigrations(this.name, loadMigrations(path.join(__dirname, "sql")), "bank_transfers");
  }

  init(pgIndexer: PgIndexer<GnoAdapter>): void {
    this.pgIndexer = pgIndexer;
    this.indexer = pgIndexer.indexer;

    // Genesis balances, in chunks: one row per address and denomination at height 0
    this.indexer.on("genesis/array/app_state.balances", async (event) => {
      const addresses: string[] = [];
      const denoms: string[] = [];
      const amounts: string[] = [];
      for (const entry of event.value) {
        const balance = parseGenesisBalance(entry);
        for (const coin of parseCoins(balance.amount)) {
          addresses.push(balance.address);
          denoms.push(coin.denom);
          amounts.push(coin.amount.toString());
        }
      }
      if (addresses.length === 0) {
        return;
      }
      const endTimer = this.indexer.prometheus?.timeDatabaseQuery("add-genesis-balances") ?? void 0;
      await this.pgIndexer.getInstance().query({
        name: "add-genesis-balances",
        text: "INSERT INTO balances(address, denom, amount, height) SELECT a, d, m::numeric, 0 FROM UNNEST($1::text[], $2::text[], $3::text[]) AS t(a, d, m) ON CONFLICT (address, denom) DO UPDATE SET amount = EXCLUDED.amount",
        values: [addresses, denoms, amounts],
      });
      endTimer?.();
    });

    this.indexer.on("block", async (event) => {
      this.touched.clear();
      this.blockHasTxs = event.value.block.block.txs.length > 0;
    });

    this.indexer.on("begin_block", async (event) => {
      await this.saveTransfers(event.value.events, "begin_block", null, null, event.height!, event.timestamp!);
    });

    this.indexer.on("tx", async (event) => {
      const tx = event.value;
      // Fees are deducted before the messages run, so a failed transaction still moves coins
      for (const signer of tx.signers) {
        this.touched.add(signer);
      }
      await this.saveTransfers(tx.events, "tx", tx.hash, tx.index, event.height!, event.timestamp!);
    });

    this.indexer.on("end_block", async (event) => {
      await this.saveTransfers(event.value, "end_block", null, null, event.height!, event.timestamp!);
      if (this.queryBalances) {
        if (this.blockHasTxs) {
          for (const address of this.trackAddresses) {
            this.touched.add(address);
          }
        }
        await this.refreshBalances([...this.touched], event.height!);
      }
      this.touched.clear();
    });
  }

  /** Stores the transfer events of one phase or transaction and notes the parties as touched */
  private async saveTransfers(events: readonly Event[], phase: string, txHash: string | null, txIndex: number | null, height: number, timestamp: string): Promise<void> {
    const rows: Array<{
      index: number
      from: string
      to: string
      coins: string
    }> = [];
    events.forEach((event, index) => {
      const transfer = parseTransferEvent(event);
      if (transfer) {
        rows.push({
          index,
          from: transfer.from,
          to: transfer.to,
          coins: transfer.raw,
        });
        this.touched.add(transfer.from);
        this.touched.add(transfer.to);
      }
    });
    if (rows.length === 0) {
      return;
    }
    const endTimer = this.indexer.prometheus?.timeDatabaseQuery("add-bank-transfers") ?? void 0;
    await this.pgIndexer.getInstance().query({
      name: "add-bank-transfers",
      text: "INSERT INTO bank_transfers(height, phase, tx_hash, tx_index, event_index, from_address, to_address, coins, timestamp) "
        + "SELECT $1, $2, $3, $4, i, f, t, c, $5 FROM UNNEST($6::int[], $7::text[], $8::text[], $9::text[]) AS e(i, f, t, c)",
      values: [height, phase, txHash, txIndex, timestamp, rows.map(r => r.index), rows.map(r => r.from), rows.map(r => r.to), rows.map(r => r.coins)],
    });
    endTimer?.();
  }

  /** Reads every touched address from the node at `height` and records the balances that changed */
  private async refreshBalances(addresses: string[], height: number): Promise<void> {
    if (addresses.length === 0) {
      return;
    }
    const db = this.pgIndexer.getInstance();
    const endTimer = this.indexer.prometheus?.timeDatabaseQuery("refresh-balances") ?? void 0;
    for (const address of addresses) {
      const coins = parseCoins(await this.balanceOf(address, height));
      // Denominations the address no longer holds go to zero
      const known = await db.query({
        name: "balance-denoms",
        text: "SELECT denom FROM balances WHERE address = $1",
        values: [address],
      });
      const rows = new Map<string, string>(known.rows.map(row => [row.denom as string, "0"]));
      for (const coin of coins) {
        rows.set(coin.denom, coin.amount.toString());
      }
      for (const [denom, amount] of rows) {
        const changed = await db.query({
          name: "upsert-balance",
          text: "INSERT INTO balances(address, denom, amount, height) VALUES ($1,$2,$3::numeric,$4) "
            + "ON CONFLICT (address, denom) DO UPDATE SET amount = EXCLUDED.amount, height = EXCLUDED.height WHERE balances.amount IS DISTINCT FROM EXCLUDED.amount "
            + "RETURNING address",
          values: [address, denom, amount, height],
        });
        if (changed.rowCount) {
          await db.query({
            name: "add-balance-history",
            text: "INSERT INTO balance_history(address, denom, amount, height) VALUES ($1,$2,$3::numeric,$4) ON CONFLICT (address, denom, height) DO UPDATE SET amount = EXCLUDED.amount",
            values: [address, denom, amount, height],
          });
        }
      }
    }
    endTimer?.();
  }

  /** The coins string the node reports for an address at a height ("" for an unknown account) */
  private async balanceOf(address: string, height: number): Promise<string> {
    const reply = await this.indexer.callABCI("bank/balances/" + address, new Uint8Array(), height);
    if (reply.length === 0) {
      return "";
    }
    const parsed = JSON.parse(Buffer.from(reply).toString()) as unknown;
    return typeof parsed === "string" ? parsed : "";
  }
}
