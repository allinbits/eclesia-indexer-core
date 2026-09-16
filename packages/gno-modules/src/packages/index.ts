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
  aminoInt, genesisTimestamp, isRealmPath,
} from "../helpers.js";

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type PackagesModuleOptions = {
  /** Store package sources in `package_files` (default: true) */
  storeFiles?: boolean
};

/** What the module needs to know about a deployment, from a transaction or from genesis */
type Deployment = {
  path: string
  name: string
  creator: string
  files: Array<{
    name: string
    body: string
  }>
  send: string | null
  maxDeposit: string | null
  height: number | null
  txHash: string | null
  msgIndex: number | null
  fromGenesis: boolean
  genesisBlockHeight: number | null
  timestamp: Date | string | null
};

/**
 * Packages module for gno.land: a registry of every package and realm deployed on the chain,
 * with its sources, from `/vm.m_addpkg` transactions and from the genesis transactions.
 */
export class PackagesModule implements Types.IndexingModule<GnoAdapter> {
  indexer!: EclesiaIndexer<GnoAdapter>;

  private pgIndexer!: PgIndexer<GnoAdapter>;

  private readonly storeFiles: boolean;

  public name: string = "gno.packages";

  public depends: string[] = [];

  public provides: string[] = ["gno.packages"];

  constructor(options: PackagesModuleOptions = {
  }) {
    this.storeFiles = options.storeFiles ?? true;
  }

  async setup() {
    await this.pgIndexer.applyMigrations(this.name, loadMigrations(path.join(__dirname, "sql")), "packages");
  }

  init(pgIndexer: PgIndexer<GnoAdapter>): void {
    this.pgIndexer = pgIndexer;
    this.indexer = pgIndexer.indexer;

    this.indexer.on("/vm.m_addpkg", async (event) => {
      const {
        msg, txHash, msgIndex,
      } = event.value;
      if (!msg.package) {
        return;
      }
      await this.save({
        path: msg.package.path,
        name: msg.package.name,
        creator: msg.creator,
        files: msg.package.files,
        send: msg.send,
        maxDeposit: msg.maxDeposit,
        height: event.height ?? null,
        txHash,
        msgIndex,
        fromGenesis: false,
        genesisBlockHeight: null,
        timestamp: event.timestamp ?? null,
      });
    });

    // Approval flow: enable and reject only update a package the chain already parked
    this.indexer.on("/vm.m_enable_pkg", async (event) => {
      const {
        msg, txHash,
      } = event.value;
      const endTimer = this.indexer.prometheus?.timeDatabaseQuery("enable-package") ?? void 0;
      await this.pgIndexer.getInstance().query({
        name: "enable-package",
        text: "UPDATE packages SET enabled_height = $2, enabled_tx_hash = $3, enabled_by = $4, pkg_hash = $5, pkg_height = $6 WHERE path = $1",
        values: [msg.pkgPath, event.height, txHash, msg.approver, msg.pkgHash || null, msg.pkgHeight.toString()],
      });
      endTimer?.();
    });

    this.indexer.on("/vm.m_reject_pkg", async (event) => {
      const {
        msg, txHash,
      } = event.value;
      const endTimer = this.indexer.prometheus?.timeDatabaseQuery("reject-package") ?? void 0;
      await this.pgIndexer.getInstance().query({
        name: "reject-package",
        text: "UPDATE packages SET rejected_height = $2, rejected_tx_hash = $3, rejected_by = $4 WHERE path = $1",
        values: [msg.pkgPath, event.height, txHash, msg.sender],
      });
      endTimer?.();
    });

    // Amino JSON form: snake_case fields, numbers as strings
    this.indexer.on("gentx/vm.m_addpkg", async (event) => {
      const msg = event.value.msg as {
        creator?: string
        package?: {
          name?: string
          path?: string
          files?: Array<{
            name: string
            body: string
          }> | null
        } | null
        send?: string
        max_deposit?: string
      };
      if (!msg.package?.path) {
        return;
      }
      await this.save({
        path: msg.package.path,
        name: msg.package.name ?? "",
        creator: msg.creator ?? "",
        files: msg.package.files ?? [],
        send: msg.send ?? null,
        maxDeposit: msg.max_deposit ?? null,
        height: null,
        txHash: null,
        msgIndex: event.value.msgIndex,
        fromGenesis: true,
        genesisBlockHeight: aminoInt(event.value.metadata?.block_height),
        timestamp: genesisTimestamp(event.value.metadata),
      });
    });
  }

  /** Records a deployment; a path that already exists (a replayed or duplicate deployment) is left as is */
  private async save(deployment: Deployment): Promise<void> {
    const db = this.pgIndexer.getInstance();
    const endTimer = this.indexer.prometheus?.timeDatabaseQuery("add-package") ?? void 0;
    const inserted = await db.query({
      name: "add-package",
      text: "INSERT INTO packages(path, name, creator, is_realm, height, tx_hash, msg_index, from_genesis, genesis_block_height, send, max_deposit, files_count, timestamp) "
        + "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (path) DO NOTHING",
      values: [deployment.path, deployment.name, deployment.creator, isRealmPath(deployment.path), deployment.height, deployment.txHash, deployment.msgIndex, deployment.fromGenesis, deployment.genesisBlockHeight, deployment.send, deployment.maxDeposit, deployment.files.length, deployment.timestamp],
    });
    if (inserted.rowCount && this.storeFiles && deployment.files.length > 0) {
      await db.query({
        name: "add-package-files",
        text: "INSERT INTO package_files(pkg_path, name, body) SELECT $1, n, b FROM UNNEST($2::text[], $3::text[]) AS f(n, b) ON CONFLICT DO NOTHING",
        values: [deployment.path, deployment.files.map(f => f.name), deployment.files.map(f => f.body)],
      });
    }
    endTimer?.();
  }
}
