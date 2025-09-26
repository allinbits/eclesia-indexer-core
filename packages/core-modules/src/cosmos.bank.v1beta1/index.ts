import * as fs from "node:fs";
import * as path from "node:path";
import {
  fileURLToPath,
} from "node:url";

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
  BlockResultsResponse as BlockResultsResponse38,
} from "@cosmjs/tendermint-rpc/build/comet38/responses.js";
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

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Events emitted by the Bank module for genesis balance loading */
export type Events = {
  "genesis/array/app_state.bank.balances": {
    value: Balance[]
  }
};

/**
 * Cosmos SDK Bank module indexer that tracks account balances and coin transfers
 * Handles balance changes from coin_spent, coin_received, burn, and coinbase events
 */
export class BankModule implements Types.IndexingModule {
  indexer!: EcleciaIndexer;

  private pgIndexer!: PgIndexer;

  /** Registry of protobuf message types for decoding */
  private registry: [string, GeneratedType][];

  public name: string = "cosmos.bank.v1beta1";

  /** Depends on auth module for account management */
  public depends: string[] = ["cosmos.auth.v1beta1"];

  public provides: string[] = ["cosmos.bank.v1beta1"];

  constructor(registry: [string, GeneratedType][]) {
    this.registry = registry;
  }

  /**
   * Initializes the database schema for balance tracking
   * Creates the balances table if it doesn't exist
   */
  async setup() {
    await this.pgIndexer.beginTransaction();
    const client = this.pgIndexer.getInstance();

    // Check if the balances table already exists
    const exists = await client.query(
      "SELECT EXISTS ( SELECT FROM pg_tables WHERE  schemaname = 'public' AND tablename  = 'balances')",
    );

    if (!exists.rows[0].exists) {
      this.indexer.log.warn("Database not configured");
      // Load and execute the bank module schema SQL file
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

  /**
   * Initializes the bank module with event handlers for balance tracking
   * @param pgIndexer - The PostgreSQL indexer instance
   */
  init(pgIndexer: PgIndexer): void {
    this.pgIndexer = pgIndexer;
    this.indexer = pgIndexer.indexer;

    // Build registry map for protobuf message decoding
    const registryMap: Map<string, (typeof this.registry)[0][1]> = new Map();
    for (let i = 0; i < this.registry.length; i++) {
      registryMap.set(this.registry[i][0], this.registry[i][1]);
    }

    // Handle genesis balances during chain initialization
    this.indexer.on("genesis/array/app_state.bank.balances", async (event) => {
      const db = this.pgIndexer.getInstance();
      const addresses = event.value.map((x: Balance) => x.address);
      const balances = event.value.map((x: Balance) => x.coins);

      // Ensure all accounts exist before setting balances
      await (this.pgIndexer.modules["cosmos.auth.v1beta1"] as AuthModule).assertAccounts(addresses);

      // Format coin arrays for PostgreSQL COIN[] type
      const values = [
        addresses,
        balances.map((y: Coin[]) => {
          return "{\"" + y.map((x: Coin) => {
            return "(" + x.denom + ", " + x.amount + ")";
          }).join(",") + "\"}";
        }),
      ];

      // Bulk insert genesis balances
      await db.query({
        name: "save-genesis-balances",
        text: "INSERT INTO balances(address,coins)  SELECT a,CAST( b as COIN[]) FROM UNNEST ($1::text[], $2::text[]) as t(a,b)",
        values,
      });
    });
    // Handle balance-affecting events from begin_block, transactions, and end_block
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

  /**
   * Processes blockchain events to update account balances
   * Handles coin_spent, coin_received, burn, and coinbase events
   * @param data - Event data from begin_block, transactions, or end_block
   */
  async eventHandler(data: {
    value:
      | BlockResultsResponse["beginBlockEvents"]
      | BlockResultsResponse["endBlockEvents"]
      | BlockResultsResponse38["finalizeBlockEvents"]
      | BlockResultsResponse["results"]
      | BlockResultsResponse38["results"]
    height?: number
    uuid?: string
  }) {
    let events: readonly (BlockResultsResponse38["finalizeBlockEvents"][0] | BlockResultsResponse["beginBlockEvents"][0])[];
    // Flatten transaction events if needed
    if (this.isTxResults(data.value)) {
      events = data.value.map(x => x.events).flat();
    }
    else {
      events = data.value;
    }

    // Process each event to update balances
    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      // Handle coin spending events (transfers, fees, etc.)
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
      // Handle coin burning events (permanent coin destruction)
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

      // Handle coin receiving events (transfers, rewards, etc.)
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

      // Handle coinbase events (new coin minting)
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

  /**
   * Type guard to determine if event data contains transaction results
   * @param data - Event data that could be from begin_block, end_block, or transactions
   * @returns true if data contains transaction results with events
   */
  isTxResults(
    data:
      | BlockResultsResponse["beginBlockEvents"]
      | BlockResultsResponse["endBlockEvents"]
      | BlockResultsResponse38["finalizeBlockEvents"]
      | BlockResultsResponse["results"]
      | BlockResultsResponse38["results"],
  ): data is BlockResultsResponse["results"] | BlockResultsResponse38["results"] {
    if (data.length > 0) {
      return (data as BlockResultsResponse["results"])[0].events !== undefined;
    }
    else {
      return false;
    }
  }

  /**
   * Queries the chain for an account's balance at genesis
   * Used during chain initialization to get module account balances
   * @param name - Account address to query
   * @returns Array of coin balances
   */
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

  /**
   * Retrieves an account's balance at a specific block height
   * Falls back to genesis balance if no balance found at height
   * @param address - Account address
   * @param height - Block height (optional, defaults to latest)
   * @returns Array of coin balances
   */
  async getBalance(
    address: string,
    height?: number,
  ): Promise<Coin[]> {
    const db = this.pgIndexer.getInstance();
    // Get the most recent balance at or before the specified height
    const res = await db.query(
      "SELECT to_json(coins) FROM balances WHERE address=$1 AND height<=$2 ORDER BY height DESC LIMIT 1", [address, height],
    );
    if (res.rowCount == 0) {
      // Fall back to genesis balance (height IS NULL)
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

  /**
   * Increases an account's balance by the specified amount
   * Handles multiple denominations and creates new entries if needed
   * @param address - Account address
   * @param amount - Coin amount string (e.g., "100uatom,50stake")
   * @param height - Block height (optional for genesis)
   */
  async increaseBalance(
    address: string,
    amount: string,
    height?: number,
  ) {
    const coins = parseCoins(amount);
    const balance = (await this.getBalance(address, height)) as Coin[];

    // Add each coin to the existing balance
    for (let i = 0; i < coins.length; i++) {
      const amount = coins[i].amount;
      const denom = coins[i].denom;
      const balanceIdx = balance.findIndex(x => x.denom == denom);
      if (balanceIdx >= 0) {
        // Add to existing balance
        balance[balanceIdx].amount = (
          BigInt(balance[balanceIdx].amount) + BigInt(amount)
        ).toString();
      }
      else {
        // Create new balance entry
        balance.push(coins[i]);
      }
    }

    // Save the updated balance
    if (height) {
      await this.saveBalance(address, balance, height);
    }
    else {
      await this.saveGenesisBalance(address, balance);
    }
  }

  /**
   * Decreases an account's balance by the specified amount
   * Handles multiple denominations; creates negative entries if balance insufficient
   * @param address - Account address
   * @param amount - Coin amount string (e.g., "100uatom,50stake")
   * @param height - Block height (optional for genesis)
   */
  async decreaseBalance(
    address: string,
    amount: string,
    height?: number,
  ) {
    const coins = parseCoins(amount);
    const balance = await this.getBalance(address, height);

    // Subtract each coin from the existing balance
    for (let i = 0; i < coins.length; i++) {
      const amount = coins[i].amount;
      const denom = coins[i].denom;
      const balanceIdx = balance.findIndex(x => x.denom == denom);
      if (balanceIdx >= 0) {
        // Subtract from existing balance
        balance[balanceIdx].amount = (
          BigInt(balance[balanceIdx].amount) - BigInt(amount)
        ).toString();
      }
      else {
        // Create negative balance entry (shouldn't happen in normal operation)
        balance.push(coins[i]);
      }
    }

    // Save the updated balance
    if (height) {
      await this.saveBalance(address, balance, height);
    }
    else {
      await this.saveGenesisBalance(address, balance);
    }
  }

  /**
   * Saves an account's balance at a specific block height
   * Uses upsert to handle conflicts when balance already exists at height
   * @param address - Account address
   * @param amount - Array of coin balances
   * @param height - Block height
   */
  async saveBalance(address: string, amount: Coin[], height: number) {
    const db = this.pgIndexer.getInstance();

    if (amount.length > 0) {
      // Ensure account exists before saving balance
      await (this.pgIndexer.modules["cosmos.auth.v1beta1"] as AuthModule).assertAccount(address);

      // Upsert balance with conflict resolution
      await db.query({
        name: "save-balance",
        text: "INSERT INTO balances(address,coins,height) VALUES ($1,$2::COIN[],$3) ON CONFLICT ON CONSTRAINT unique_height_balance DO UPDATE SET coins=excluded.coins WHERE balances.address=excluded.address AND balances.height=excluded.height",
        values: [
          address,
          // Format coins for PostgreSQL COIN[] type
          amount.map((x) => {
            return "(\"" + x.denom + "\", \"" + x.amount + "\")";
          }),
          height,
        ],
      });
    }
  }

  /**
   * Saves an account's genesis balance (height = NULL)
   * Replaces any existing genesis balance for the account
   * @param address - Account address
   * @param amount - Array of coin balances
   */
  async saveGenesisBalance(address: string, amount: Coin[]) {
    const db = this.pgIndexer.getInstance();

    if (amount.length > 0) {
      // Ensure account exists before saving balance
      await (this.pgIndexer.modules["cosmos.auth.v1beta1"] as AuthModule).assertAccount(address);

      // Remove existing genesis balance and insert new one
      await db.query("DELETE FROM balances WHERE address=$1 AND height IS NULL", [address]);
      await db.query({
        name: "save-genesis-balance",
        text: "INSERT INTO balances(address,coins) VALUES ($1,$2::COIN[])",
        values: [
          address,
          // Format coins for PostgreSQL COIN[] type
          amount.map((x) => {
            return "(\"" + x.denom + "\", \"" + x.amount + "\")";
          }),
        ],
      });
    }
  }
}
