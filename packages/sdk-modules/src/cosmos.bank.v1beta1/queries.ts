import { parseCoins } from "@cosmjs/proto-signing";
import { DB, Utils } from "@eclesia/indexer";
import {
  QueryAllBalancesRequest,
  QueryAllBalancesResponse,
} from "cosmjs-types/cosmos/bank/v1beta1/query";
import { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin";

const getGenesisBalance = async (name: string) => {
  const q = QueryAllBalancesRequest.fromPartial({ address: name });
  const balance = QueryAllBalancesRequest.encode(q).finish();
  const balanceq = await Utils.callABCI(
    "/cosmos.bank.v1beta1.Query/AllBalances",
    balance,
    1
  );
  const bal = QueryAllBalancesResponse.decode(balanceq).balances;

  return bal;
};

const getBalance = async (
  address: string,
  height?: number
): Promise<Coin[]> => {
  const db = DB.getInstance();
  const res = await db.query(
    "SELECT to_json(coins) FROM balances WHERE address=$1 AND height<=$2 ORDER BY height DESC LIMIT 1",
    [address, height]
  );
  if (res.rowCount == 0) {
    const nullres = await db.query(
      "SELECT to_json(coins) FROM balances WHERE address=$1 AND height IS NULL LIMIT 1",
      [address]
    );
    if (nullres.rowCount == 0) {
      return [];
    } else {
      return nullres.rows[0].to_json;
    }
  } else {
    return res.rows[0].to_json;
  }
};
const increaseBalance = async (
  address: string,
  amount: string,
  height?: number
) => {
  const coins = parseCoins(amount);
  const balance = (await getBalance(address, height)) as Coin[];
  for (let i = 0; i < coins.length; i++) {
    const amount = coins[i].amount;
    const denom = coins[i].denom;
    const balanceIdx = balance.findIndex((x) => x.denom == denom);
    if (balanceIdx >= 0) {
      balance[balanceIdx].amount = (
        BigInt(balance[balanceIdx].amount) + BigInt(amount)
      ).toString();
    } else {
      balance.push(coins[i]);
    }
  }
  if (height) {
    await saveBalance(address, balance, height);
  } else {
    await saveGenesisBalance(address, balance);
  }
};
const decreaseBalance = async (
  address: string,
  amount: string,
  height?: number
) => {
  const coins = parseCoins(amount);
  const balance = await getBalance(address, height);
  for (let i = 0; i < coins.length; i++) {
    const amount = coins[i].amount;
    const denom = coins[i].denom;
    const balanceIdx = balance.findIndex((x) => x.denom == denom);
    if (balanceIdx >= 0) {
      balance[balanceIdx].amount = (
        BigInt(balance[balanceIdx].amount) - BigInt(amount)
      ).toString();
    } else {
      balance.push(coins[i]);
    }
  }
  if (height) {
    await saveBalance(address, balance, height);
  } else {
    await saveGenesisBalance(address, balance);
  }
};
const saveBalance = async (address: string, amount: Coin[], height: number) => {
  const db = DB.getInstance();

  if (amount.length > 0) {
    await DB.assertAccount(address);
    db.query({
      name: "save-balance",
      text: "INSERT INTO balances(address,coins,height) VALUES ($1,$2::COIN[],$3) ON CONFLICT ON CONSTRAINT unique_height_balance DO UPDATE SET coins=excluded.coins WHERE balances.address=excluded.address AND balances.height=excluded.height",
      values: [
        address,
        amount.map((x) => {
          return '("' + x.denom + '", "' + x.amount + '")';
        }),
        height,
      ],
    });
  }
};
const saveGenesisBalance = async (address: string, amount: Coin[]) => {
  const db = DB.getInstance();

  if (amount.length > 0) {
    await DB.assertAccount(address);
    db.query("DELETE FROM balances WHERE address=$1 AND height IS NULL", [
      address,
    ]);
    db.query({
      name: "save-genesis-balance",
      text: "INSERT INTO balances(address,coins) VALUES ($1,$2::COIN[])",
      values: [
        address,
        amount.map((x) => {
          return '("' + x.denom + '", "' + x.amount + '")';
        }),
      ],
    });
  }
};
export { decreaseBalance, getBalance, getGenesisBalance, increaseBalance };
