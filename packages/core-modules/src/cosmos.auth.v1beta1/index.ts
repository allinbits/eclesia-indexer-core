import * as fs from "node:fs";
import * as path from "node:path";
import {
  fileURLToPath,
} from "node:url";

import {
  GeneratedType,
} from "@cosmjs/proto-signing";
import {
  PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  EcleciaIndexer, Types,
} from "@eclesia/indexer-engine";
import {
  ModuleAccount,
} from "cosmjs-types/cosmos/auth/v1beta1/auth.js";
import {
  QueryModuleAccountByNameRequest,
  QueryModuleAccountByNameResponse,
} from "cosmjs-types/cosmos/auth/v1beta1/query.js";

import {
  BankModule,
} from "../cosmos.bank.v1beta1/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type Events = {

  "genesis/array/app_state.auth.accounts": {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any[]
  }
};

export class AuthModule implements Types.IndexingModule {
  indexer!: EcleciaIndexer;

  private pgIndexer!: PgIndexer;

  private registry: [string, GeneratedType][];

  public name: string = "cosmos.auth.v1beta1";

  public depends: string[] = [];

  public provides: string[] = ["cosmos.auth.v1beta1"];

  constructor(registry: [string, GeneratedType][]) {
    this.registry = registry;
  }

  async setup() {
    await this.pgIndexer.beginTransaction();
    const client = this.pgIndexer.getInstance();
    const exists = await client.query(
      "SELECT EXISTS ( SELECT FROM pg_tables WHERE  schemaname = 'public' AND tablename  = 'accounts')",
    );
    if (!exists.rows[0].exists) {
      this.indexer.log.warn("Database not configured");
      const base = fs.readFileSync(__dirname + "/./sql/module.sql").toString();
      try {
        await client.query(base);
        this.indexer.log.info("DB has been set up");
        await this.pgIndexer.endTransaction(true);
      }
      catch (e) {
        await this.pgIndexer.endTransaction(false);
        throw new Error("" + e);
      }
    }
    else {
      await this.pgIndexer.endTransaction(true);
    }
  }

  init(pgIndexer: PgIndexer): void {
    this.pgIndexer = pgIndexer;
    this.indexer = pgIndexer.indexer;
    const registryMap: Map<string, (typeof this.registry)[0][1]> = new Map();
    for (let i = 0; i < this.registry.length; i++) {
      registryMap.set(this.registry[i][0], this.registry[i][1]);
    }

    this.indexer.on("block", async (event): Promise<void> => {
      if (event.value.block.block.header.height == 1) {
        /*
         Module accounts and module account balances are created/set during processing of gen txs.
         We have no events for those so we query/set them explicitly prior to processing block #1
        */
        const moduleAccounts: string[] = [];
        let acc = await this.getModuleAccount("fee_collector");
        if (acc) {
          moduleAccounts.push(acc);
        }
        acc = await this.getModuleAccount("inflation");
        if (acc) {
          moduleAccounts.push(acc);
        }
        acc = await this.getModuleAccount("transfer");
        if (acc) {
          moduleAccounts.push(acc);
        }
        acc = await this.getModuleAccount("mint");
        if (acc) {
          moduleAccounts.push(acc);
        }
        acc = await this.getModuleAccount("bonded_tokens_pool");
        if (acc) {
          moduleAccounts.push(acc);
        }
        acc = await this.getModuleAccount("not_bonded_tokens_pool");
        if (acc) {
          moduleAccounts.push(acc);
        }
        acc = await this.getModuleAccount("gov");
        if (acc) {
          moduleAccounts.push(acc);
        }
        acc = await this.getModuleAccount("distribution");
        if (acc) {
          moduleAccounts.push(acc);
        }
        acc = await this.getModuleAccount("ibc");
        if (acc) {
          moduleAccounts.push(acc);
        }
        for (let k = 0; k < moduleAccounts.length; k++) {
          await this.assertAccount(moduleAccounts[k]);

          if (this.pgIndexer.modules && this.pgIndexer.modules["cosmos.bank.v1beta1"]) {
            const balance = await (this.pgIndexer.modules["cosmos.bank.v1beta1"] as BankModule).getGenesisBalance(moduleAccounts[k]);
            if (balance.length > 0) {
              await this.indexer.asyncEmit("genesis/array/app_state.bank.balances", {
                value: [
                  {
                    address: moduleAccounts[k],
                    coins: balance,
                  },
                ],
              });
            }
          }
        }
      }
    });
    this.indexer.on(
      "genesis/array/app_state.auth.accounts", async (event): Promise<void> => {
        const accounts: string[] = [];
        for (let i = 0; i < event.value.length; i++) {
          switch (event.value[i]["@type"]) {
            case "/cosmos.auth.v1beta1.ModuleAccount":
              accounts.push(event.value[i].base_account.address);
              break;
            case "/cosmos.vesting.v1beta1.DelayedVestingAccount":
              accounts.push(event.value[i].base_vesting_account.base_account.address);
              break;
            case "/cosmos.vesting.v1beta1.ContinuousVestingAccount":
              accounts.push(event.value[i].base_vesting_account.base_account.address);
              break;
            default:
            case "/cosmos.auth.v1beta1.BaseAccount":
              accounts.push(event.value[i].address);
              break;
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
