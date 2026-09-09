import * as path from "node:path";
import {
  fileURLToPath,
} from "node:url";

import {
  GeneratedType,
} from "@cosmjs/proto-signing";
import {
  loadMigrations, PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  EclesiaIndexer, Types,
} from "@eclesia/indexer-engine";
import {
  ModuleAccount,
} from "cosmjs-types/cosmos/auth/v1beta1/auth.js";
import {
  QueryModuleAccountByNameRequest, QueryModuleAccountByNameResponse, QueryModuleAccountsRequest, QueryModuleAccountsResponse,
} from "cosmjs-types/cosmos/auth/v1beta1/query.js";

import {
  BankModule,
} from "../cosmos.bank.v1beta1/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Module account names looked up individually when the chain predates the ModuleAccounts query */
export const WELL_KNOWN_MODULE_ACCOUNTS = ["fee_collector", "inflation", "transfer", "mint", "bonded_tokens_pool", "not_bonded_tokens_pool", "gov", "distribution", "ibc"] as const;

export type Events = {

  "genesis/array/app_state.auth.accounts": {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any[]
  }
};

/** Shape shared by every account type exported to genesis: the bech32 address sits at one of three depths */
export type GenesisAccount = {
  "@type"?: string
  address?: string
  base_account?: {
    address?: string
  }
  base_vesting_account?: {
    base_account?: {
      address?: string
    }
  }
};

/**
 * Resolves the address of any genesis account regardless of its wrapper type:
 * BaseAccount (top level), ModuleAccount / EthAccount / InterchainAccount (base_account),
 * and every x/auth/vesting type (base_vesting_account.base_account).
 * @param account - Raw genesis account object
 * @returns The bech32 address, or undefined if the shape is unknown
 */
export const genesisAccountAddress = (account: GenesisAccount | null | undefined): string | undefined => {
  return account?.address
    ?? account?.base_account?.address
    ?? account?.base_vesting_account?.base_account?.address;
};

export class AuthModule implements Types.IndexingModule {
  indexer!: EclesiaIndexer;

  private pgIndexer!: PgIndexer;

  private registry: [string, GeneratedType][];

  public name: string = "cosmos.auth.v1beta1";

  public depends: string[] = [];

  public provides: string[] = ["cosmos.auth.v1beta1"];

  constructor(registry: [string, GeneratedType][]) {
    this.registry = registry;
  }

  async setup() {
    await this.pgIndexer.applyMigrations(this.name, loadMigrations(path.join(__dirname, "sql")), "accounts");
  }

  init(pgIndexer: PgIndexer): void {
    this.pgIndexer = pgIndexer;
    this.indexer = pgIndexer.indexer;
    const registryMap: Map<string, (typeof this.registry)[0][1]> = new Map();
    for (let i = 0; i < this.registry.length; i++) {
      registryMap.set(this.registry[i][0], this.registry[i][1]);
    }

    this.indexer.on("block", async (event): Promise<void> => {
      /*
       Module accounts and their balances are created during InitChain and the first block, and no
       events describe them. Once block 1 has been fully processed and committed (that is, when
       block 2 starts) we snapshot every module account's balance as of the end of block 1. Doing
       it at the start of block 1 double-counted block 1's own flows; doing it at the end of block
       1 raced the bank module's end_block handler.
      */
      if (event.value.block.block.header.height == 2 && this.pgIndexer.modules && this.pgIndexer.modules["cosmos.bank.v1beta1"]) {
        const db = this.pgIndexer.getInstance();
        const first = await db.query("SELECT 1 FROM blocks WHERE height = 1");
        if (!first.rowCount) {
          this.indexer.log.debug("Block 1 is not indexed, skipping the module account balance snapshot");
          return;
        }
        const bank = this.pgIndexer.modules["cosmos.bank.v1beta1"] as BankModule;
        for (const address of await this.getModuleAccounts()) {
          await this.assertAccount(address);
          const balance = await bank.getGenesisBalance(address);
          if (balance.length > 0) {
            await bank.saveBalance(address, balance, 1);
          }
        }
      }
    });
    this.indexer.on(
      "genesis/array/app_state.auth.accounts", async (event): Promise<void> => {
        const accounts: string[] = [];
        for (let i = 0; i < event.value.length; i++) {
          const address = genesisAccountAddress(event.value[i]);
          if (address) {
            accounts.push(address);
          }
          else {
            // Never push undefined: node-pg would send NULL into the accounts primary key
            this.indexer.log.warn("Skipping genesis account with unknown shape: " + event.value[i]?.["@type"]);
          }
        }
        await this.assertAccounts(accounts);
      },
    );
  }

  async assertAccounts(addresses: string[]) {
    const db = this.pgIndexer.getInstance();

    const endTimer = this.indexer.prometheus?.timeDatabaseQuery("assert-accounts") ?? void 0;
    await db.query({
      name: "assert_accounts",
      text: "INSERT INTO accounts(address) SELECT * FROM UNNEST($1::text[]) ON CONFLICT DO NOTHING",
      values: [addresses],
    });
    endTimer?.();
  }

  async assertAccount(address: string) {
    const db = this.pgIndexer.getInstance();

    const endTimer = this.indexer.prometheus?.timeDatabaseQuery("assert-account") ?? void 0;
    const res = await db.query("SELECT address from accounts WHERE address=$1", [address]);
    if (res.rowCount == 0) {
      await db.query({
        name: "assert_account",
        text: "INSERT INTO accounts(address) values($1)",
        values: [address],
      });
    }
    endTimer?.();
  }

  /**
   * Addresses of every module account on the chain, from the ModuleAccounts query (SDK 0.46+).
   * Older chains answer with an error code; then the well-known names are looked up one by one.
   */
  async getModuleAccounts(): Promise<string[]> {
    try {
      const req = QueryModuleAccountsRequest.encode(QueryModuleAccountsRequest.fromPartial({
      })).finish();
      const res = QueryModuleAccountsResponse.decode(await this.indexer.callABCI("/cosmos.auth.v1beta1.Query/ModuleAccounts", req));
      const addresses = res.accounts
        .map(account => ModuleAccount.decode(account.value).baseAccount?.address)
        .filter((address): address is string => !!address);
      if (addresses.length > 0) {
        return addresses;
      }
    }
    catch (e) {
      this.indexer.log.warn("ModuleAccounts query unavailable, falling back to well-known module account names", {
        error: e,
      });
    }
    const addresses: string[] = [];
    for (const name of WELL_KNOWN_MODULE_ACCOUNTS) {
      try {
        const address = await this.getModuleAccount(name);
        if (address) {
          addresses.push(address);
        }
      }
      catch (e) {
        this.indexer.log.debug("Module account " + name + " could not be resolved", {
          error: e,
        });
      }
    }
    return addresses;
  }

  async getModuleAccount(name: string) {
    const q = QueryModuleAccountByNameRequest.fromJSON({
      name,
    });
    const mod = QueryModuleAccountByNameRequest.encode(q).finish();
    const modq = await this.indexer.callABCI(
      "/cosmos.auth.v1beta1.Query/ModuleAccountByName", mod,
    );
    const acc = ModuleAccount.decode(
      QueryModuleAccountByNameResponse.decode(modq).account?.value
      ?? new Uint8Array(),
    ).baseAccount?.address;
    return acc;
  }
}
