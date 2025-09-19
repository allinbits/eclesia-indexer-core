import * as fs from "node:fs";

import {
  parseCoins,
} from "@cosmjs/proto-signing";
import {
  GeneratedType,
} from "@cosmjs/proto-signing";
import {
  BlockResultsResponse,
} from "@cosmjs/tendermint-rpc";
import {
  PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  EcleciaIndexer, Types,
} from "@eclesia/indexer-engine";
import {
  Utils,
} from "@eclesia/indexer-engine";
import {
  Balance,
} from "cosmjs-types/cosmos/bank/v1beta1/genesis.js";
import {
  QueryAllBalancesRequest,
  QueryAllBalancesResponse,
} from "cosmjs-types/cosmos/bank/v1beta1/query.js";
import {
  Coin,
} from "cosmjs-types/cosmos/base/v1beta1/coin.js";

import {
  AuthModule,
} from "../cosmos.auth.v1beta1/index.js";

export type Events = {
  "genesis/array/app_state.bank.balances": {
    value: Balance[]
  }
};

export class BankModule implements Types.IndexingModule {
  indexer!: EcleciaIndexer;

  private pgIndexer!: PgIndexer;

  private registry: [string, GeneratedType][];

  public name: string = "cosmos.bank.v1beta1";

  public depends: string[] = ["cosmos.auth.v1beta1"];

  public provides: string[] = ["cosmos.bank.v1beta1"];

  constructor(registry: [string, GeneratedType][]) {
    this.registry = registry;
  }

  async setup() {
    await this.pgIndexer.beginTransaction();
    const client = this.pgIndexer.getInstance();
    const exists = await client.query(
      "SELECT EXISTS ( SELECT FROM pg_tables WHERE  schemaname = 'public' AND tablename  = 'balances')",
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

    this.indexer.on("genesis/array/app_state.bank.balances", async (event) => {
      const db = this.pgIndexer.getInstance();
      const addresses = event.value.map((x: Balance) => x.address);
      const balances = event.value.map((x: Balance) => x.coins);
      await (this.pgIndexer.modules["cosmos.auth.v1beta1"] as AuthModule).assertAccounts(addresses);
      const values = [
        addresses,
        balances.map((y: Coin[]) => {
          return "{\"" + y.map((x: Coin) => {
            return "(" + x.denom + ", " + x.amount + ")";
          }).join(",") + "\"}";
        }),
      ];
      await db.query({
        name: "save-genesis-balances",
        text: "INSERT INTO balances(address,coins)  SELECT a,CAST( b as COIN[]) FROM UNNEST ($1::text[], $2::text[]) as t(a,b)",
        values,
      });
    });
    this.indexer.on("begin_block", async (data) => {
      return await this.eventHandler({
        value: data.value.events,
        height: data.height,
        uuid: data.uuid,
      });
    });
    this.indexer.on("tx_events", async (arg) => {
      return await this.eventHandler(arg);
    });
    this.indexer.on("end_block", async (arg) => {
      return await this.eventHandler(arg);
    });
  }

  async eventHandler(data: {
    value:
      | BlockResultsResponse["beginBlockEvents"]
      | BlockResultsResponse["endBlockEvents"]
      | BlockResultsResponse["results"]
    height?: number
    uuid?: string
  }) {
    let events: BlockResultsResponse["endBlockEvents"];
    if (this.isTxResults(data.value)) {
      events = data.value.map(x => x.events).flat();
    }
    else {
      events = data.value;
    }

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (event.type == "coin_spent") {
        let spender: string | undefined;
        let amount: string | undefined;
        for (let j = 0; j < event.attributes.length; j++) {
          const key = Utils.decodeAttr(event.attributes[j].key);
          const value = Utils.decodeAttr(event.attributes[j].value);
          if (key == "spender") {
            spender = value;
          }
          if (key == "amount") {
            amount = value;
          }
        }
        if (spender && amount) {
          await this.decreaseBalance(spender, amount, data.height);
        }
      }
      if (event.type == "burn") {
        let spender: string | undefined;
        let amount: string | undefined;
        for (let j = 0; j < event.attributes.length; j++) {
          const key = Utils.decodeAttr(event.attributes[j].key);
          const value = Utils.decodeAttr(event.attributes[j].value);
          if (key == "burner") {
            spender = value;
          }
          if (key == "amount") {
            amount = value;
          }
        }
        if (spender && amount) {
          await this.decreaseBalance(spender, amount, data.height);
        }
      }
      if (event.type == "coin_received") {
        let receiver: string | undefined;
        let amount: string | undefined;
        for (let j = 0; j < event.attributes.length; j++) {
          const key = Utils.decodeAttr(event.attributes[j].key);
          const value = Utils.decodeAttr(event.attributes[j].value);
          if (key == "receiver") {
            receiver = value;
          }
          if (key == "amount") {
            amount = value;
          }
        }
        if (receiver && amount) {
          await this.increaseBalance(receiver, amount, data.height);
        }
      }
      if (event.type == "coinbase") {
        let receiver: string | undefined;
        let amount: string | undefined;
        for (let j = 0; j < event.attributes.length; j++) {
          const key = Utils.decodeAttr(event.attributes[j].key);
          const value = Utils.decodeAttr(event.attributes[j].value);
          if (key == "minter") {
            receiver = value;
          }
          if (key == "amount") {
            amount = value;
          }
        }
        if (receiver && amount) {
          await this.increaseBalance(receiver, amount, data.height);
        }
      }
    }
  }

  isTxResults(
    data:
      | BlockResultsResponse["beginBlockEvents"]
      | BlockResultsResponse["endBlockEvents"]
      | BlockResultsResponse["results"],
  ): data is BlockResultsResponse["results"] {
    if (data.length > 0) {
      return (data as BlockResultsResponse["results"])[0].events !== undefined;
    }
    else {
      return false;
    }
  }

  async getGenesisBalance(name: string) {
    const q = QueryAllBalancesRequest.fromPartial({
      address: name,
    });
    const balance = QueryAllBalancesRequest.encode(q).finish();
    const balanceq = await this.indexer.callABCI(
      "/cosmos.bank.v1beta1.Query/AllBalances", balance, 1,
    );
    const bal = QueryAllBalancesResponse.decode(balanceq).balances;

    return bal;
  }

  async getBalance(
    address: string,
    height?: number,
  ): Promise<Coin[]> {
    const db = this.pgIndexer.getInstance();
    const res = await db.query(
      "SELECT to_json(coins) FROM balances WHERE address=$1 AND height<=$2 ORDER BY height DESC LIMIT 1", [address, height],
    );
    if (res.rowCount == 0) {
      const nullres = await db.query(
        "SELECT to_json(coins) FROM balances WHERE address=$1 AND height IS NULL LIMIT 1", [address],
      );
      if (nullres.rowCount == 0) {
        return [];
      }
      else {
        return nullres.rows[0].to_json;
      }
    }
    else {
      return res.rows[0].to_json;
    }
  }

  async increaseBalance(
    address: string,
    amount: string,
    height?: number,
  ) {
    const coins = parseCoins(amount);
    const balance = (await this.getBalance(address, height)) as Coin[];
    for (let i = 0; i < coins.length; i++) {
      const amount = coins[i].amount;
      const denom = coins[i].denom;
      const balanceIdx = balance.findIndex(x => x.denom == denom);
      if (balanceIdx >= 0) {
        balance[balanceIdx].amount = (
          BigInt(balance[balanceIdx].amount) + BigInt(amount)
        ).toString();
      }
      else {
        balance.push(coins[i]);
      }
    }
    if (height) {
      await this.saveBalance(address, balance, height);
    }
    else {
      await this.saveGenesisBalance(address, balance);
    }
  }

  async decreaseBalance(
    address: string,
    amount: string,
    height?: number,
  ) {
    const coins = parseCoins(amount);
    const balance = await this.getBalance(address, height);
    for (let i = 0; i < coins.length; i++) {
      const amount = coins[i].amount;
      const denom = coins[i].denom;
      const balanceIdx = balance.findIndex(x => x.denom == denom);
      if (balanceIdx >= 0) {
        balance[balanceIdx].amount = (
          BigInt(balance[balanceIdx].amount) - BigInt(amount)
        ).toString();
      }
      else {
        balance.push(coins[i]);
      }
    }
    if (height) {
      await this.saveBalance(address, balance, height);
    }
    else {
      await this.saveGenesisBalance(address, balance);
    }
  }

  async saveBalance(address: string, amount: Coin[], height: number) {
    const db = this.pgIndexer.getInstance();

    if (amount.length > 0) {
      await (this.pgIndexer.modules["cosmos.auth.v1beta1"] as AuthModule).assertAccount(address);
      await db.query({
        name: "save-balance",
        text: "INSERT INTO balances(address,coins,height) VALUES ($1,$2::COIN[],$3) ON CONFLICT ON CONSTRAINT unique_height_balance DO UPDATE SET coins=excluded.coins WHERE balances.address=excluded.address AND balances.height=excluded.height",
        values: [
          address,
          amount.map((x) => {
            return "(\"" + x.denom + "\", \"" + x.amount + "\")";
          }),
          height,
        ],
      });
    }
  }

  async saveGenesisBalance(address: string, amount: Coin[]) {
    const db = this.pgIndexer.getInstance();

    if (amount.length > 0) {
      await (this.pgIndexer.modules["cosmos.auth.v1beta1"] as AuthModule).assertAccount(address);
      await db.query("DELETE FROM balances WHERE address=$1 AND height IS NULL", [address]);
      await db.query({
        name: "save-genesis-balance",
        text: "INSERT INTO balances(address,coins) VALUES ($1,$2::COIN[])",
        values: [
          address,
          amount.map((x) => {
            return "(\"" + x.denom + "\", \"" + x.amount + "\")";
          }),
        ],
      });
    }
  }
}
