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
import type {
  Event,
} from "@gnolang/tm2-rpc";

import {
  jsonStringify, summarizeFiles,
} from "../helpers.js";

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type MessagesModuleOptions = {
  /** Store every chain event in `gno_events` (default: true) */
  storeEvents?: boolean
};

/**
 * Messages module for gno.land: one table per message type (bank sends, realm calls, package
 * deployments, runs) for successful transactions, plus every event the chain emitted, with
 * the realm that emitted it.
 */
export class MessagesModule implements Types.IndexingModule<GnoAdapter> {
  indexer!: EclesiaIndexer<GnoAdapter>;

  private pgIndexer!: PgIndexer<GnoAdapter>;

  private readonly storeEvents: boolean;

  public name: string = "gno.messages";

  /** Rows reference blocks, so a blocks module must run first */
  public depends: string[] = ["blocks"];

  public provides: string[] = ["gno.messages", "gno.events"];

  constructor(options: MessagesModuleOptions = {
  }) {
    this.storeEvents = options.storeEvents ?? true;
  }

  async setup() {
    await this.pgIndexer.applyMigrations(this.name, loadMigrations(path.join(__dirname, "sql")), "bank_sends");
  }

  init(pgIndexer: PgIndexer<GnoAdapter>): void {
    this.pgIndexer = pgIndexer;
    this.indexer = pgIndexer.indexer;

    this.indexer.on("/bank.MsgSend", async (event) => {
      const {
        msg, txHash, msgIndex,
      } = event.value;
      const endTimer = this.indexer.prometheus?.timeDatabaseQuery("add-bank-send") ?? void 0;
      await this.pgIndexer.getInstance().query({
        name: "add-bank-send",
        text: "INSERT INTO bank_sends(height, tx_hash, msg_index, from_address, to_address, amount, timestamp) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        values: [event.height, txHash, msgIndex, msg.fromAddress, msg.toAddress, msg.amount, event.timestamp],
      });
      endTimer?.();
    });

    this.indexer.on("/vm.m_call", async (event) => {
      const {
        msg, txHash, msgIndex,
      } = event.value;
      const endTimer = this.indexer.prometheus?.timeDatabaseQuery("add-vm-call") ?? void 0;
      await this.pgIndexer.getInstance().query({
        name: "add-vm-call",
        text: "INSERT INTO vm_calls(height, tx_hash, msg_index, caller, send, max_deposit, pkg_path, func, args, timestamp) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        values: [event.height, txHash, msgIndex, msg.caller, msg.send, msg.maxDeposit, msg.pkgPath, msg.func, JSON.stringify(msg.args), event.timestamp],
      });
      endTimer?.();
    });

    this.indexer.on("/vm.m_addpkg", async (event) => {
      const {
        msg, txHash, msgIndex,
      } = event.value;
      const endTimer = this.indexer.prometheus?.timeDatabaseQuery("add-vm-addpkg") ?? void 0;
      await this.pgIndexer.getInstance().query({
        name: "add-vm-addpkg",
        text: "INSERT INTO vm_add_packages(height, tx_hash, msg_index, creator, pkg_name, pkg_path, send, max_deposit, files_count, timestamp) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        values: [event.height, txHash, msgIndex, msg.creator, msg.package?.name ?? null, msg.package?.path ?? null, msg.send, msg.maxDeposit, msg.package?.files.length ?? 0, event.timestamp],
      });
      endTimer?.();
    });

    this.indexer.on("/vm.m_run", async (event) => {
      const {
        msg, txHash, msgIndex,
      } = event.value;
      const endTimer = this.indexer.prometheus?.timeDatabaseQuery("add-vm-run") ?? void 0;
      await this.pgIndexer.getInstance().query({
        name: "add-vm-run",
        text: "INSERT INTO vm_runs(height, tx_hash, msg_index, caller, send, max_deposit, pkg_name, files, timestamp) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        values: [event.height, txHash, msgIndex, msg.caller, msg.send, msg.maxDeposit, msg.package?.name ?? null, JSON.stringify(summarizeFiles(msg.package?.files, true)), event.timestamp],
      });
      endTimer?.();
    });

    if (!this.storeEvents) {
      return;
    }
    this.indexer.on("begin_block", async (event) => {
      await this.saveEvents(event.value.events, "begin_block", null, null, event.height!, event.timestamp!);
    });
    this.indexer.on("tx", async (event) => {
      await this.saveEvents(event.value.events, "tx", event.value.hash, event.value.index, event.height!, event.timestamp!);
    });
    this.indexer.on("end_block", async (event) => {
      await this.saveEvents(event.value, "end_block", null, null, event.height!, event.timestamp!);
    });
  }

  /** Stores the events of one phase or transaction in one statement */
  private async saveEvents(events: readonly Event[], phase: string, txHash: string | null, txIndex: number | null, height: number, timestamp: string): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const endTimer = this.indexer.prometheus?.timeDatabaseQuery("add-gno-events") ?? void 0;
    await this.pgIndexer.getInstance().query({
      name: "add-gno-events",
      text: "INSERT INTO gno_events(height, phase, tx_hash, tx_index, event_index, amino_type, type, pkg_path, attrs, raw, timestamp) "
        + "SELECT $1, $2, $3, $4, i - 1, a, t, p, at::jsonb, r::jsonb, $5 "
        + "FROM UNNEST($6::text[], $7::text[], $8::text[], $9::text[], $10::text[]) WITH ORDINALITY AS e(a, t, p, at, r, i)",
      values: [height, phase, txHash, txIndex, timestamp, events.map(e => e["@type"] ?? ""), events.map(e => e.type ?? ""), events.map(e => e.pkg_path ?? ""), events.map(e => JSON.stringify(e.attrs ?? [])), events.map(e => jsonStringify(e))],
    });
    endTimer?.();
  }
}
