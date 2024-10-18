import { DB } from "@eclesia/indexer";
import { Utils } from "@eclesia/indexer";
import { log } from "@eclesia/indexer/dist/bus";
import { getInstance } from "@eclesia/indexer/dist/db";
import BigNumber from "bignumber.js";
import { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin";
import {
  QueryDelegatorDelegationsRequest,
  QueryDelegatorDelegationsResponse,
} from "cosmjs-types/cosmos/staking/v1beta1/query";
import {
  bondStatusToJSON,
  Params as StakingParams,
  Pool,
  Validator,
} from "cosmjs-types/cosmos/staking/v1beta1/staking";

import { validatorAddressCache, validatorCache } from ".";

const tokensToShares = async (amount: bigint, validator: string) => {
  const val = validatorCache.get(validator);
  if (val) {
    const rate = new BigNumber(val.tokens.toString()).dividedBy(
      val.delegator_shares
    );
    return new BigNumber(amount.toString()).dividedBy(rate);
  } else {
    throw new Error("Validator does not exist");
  }
};
const sharesToTokens = async (amount: string, validator: string) => {
  const val = validatorCache.get(validator);
  if (val) {
    const rate = new BigNumber(val.tokens.toString()).dividedBy(
      val.delegator_shares
    );
    return new BigNumber(amount).multipliedBy(rate).dp(0, 3);
  } else {
    throw new Error("Validator does not exist");
  }
};
const tokensToSharesAtHeight = async (
  amount: bigint,
  validator: string,
  height: number
) => {
  const db = getInstance();
  const res = await db.query(
    "SELECT * FROM validator_voting_power,validator_info WHERE validator_address=validator_info.operator_address AND validator_info.consensus_address=$1 AND (validator_voting_power.height<=$2 OR validator_voting_power.height IS NULL) AND (validator_info.height<=$2 OR validator_info.height IS NULL) ORDER BY validator_voting_power.height DESC NULLS LAST,validator_info.height DESC NULLS LAST LIMIT 1",
    [validator, height]
  );
  if (res.rowCount && res.rowCount > 0) {
    const val = res.rows[0];
    const rate = new BigNumber(val.voting_power).dividedBy(
      val.delegator_shares
    );
    return new BigNumber(amount.toString()).dividedBy(rate);
  } else {
    throw new Error("Validator does not exist");
  }
};
const sharesToTokensAtHeight = async (
  amount: number,
  validator: string,
  height: number
) => {
  const consensus_address = await getConsensusAddress(validator, 0);
  const db = getInstance();
  const res = await db.query(
    "SELECT * FROM validator_voting_power,validator_info WHERE validator_address=validator_info.operator_address AND validator_info.consensus_address=$1 AND (validator_voting_power.height<=$2 OR validator_voting_power.height IS NULL) AND (validator_info.height<=$2 OR validator_info.height IS NULL) ORDER BY validator_voting_power.height DESC NULLS LAST,validator_info.height DESC NULLS LAST LIMIT 1",
    [consensus_address, height]
  );
  if (res.rowCount && res.rowCount > 0) {
    const val = res.rows[0];
    const rate = new BigNumber(val.voting_power).dividedBy(
      val.delegator_shares
    );
    return new BigNumber(amount).multipliedBy(rate).dp(0, 3);
  } else {
    throw new Error("Validator does not exist");
  }
};
const saveStakingParams = async (params: StakingParams, height: number) => {
  const db = getInstance();
  await db.query(
    "INSERT INTO staking_params (params, height) VALUES ($1, $2)",
    [params, height]
  );
  log.verbose("Saved staking params at height: " + height);
};
const getStakingParams = async (height: bigint): Promise<StakingParams> => {
  const db = getInstance();
  const params = await db.query(
    "SELECT * FROM staking_params WHERE height<=$1 OR height IS null ORDER BY height DESC NULLS LAST LIMIT 1",
    [height]
  );
  if (params.rows.length > 0) {
    return params.rows[0].params as StakingParams;
  } else {
    throw new Error("No staking params");
  }
};
const getConsensusAddress = async (validator: string, _height: number) => {
  const consensus_address = validatorAddressCache.get(validator);
  if (!consensus_address) {
    throw new Error("No consensus address");
  } else {
    return consensus_address;
  }
};
const getValidatorCommission = async (validator: string) => {
  const db = getInstance();
  const res = await db.query(
    "SELECT * FROM validator_commission WHERE validator_address=$1 ORDER BY height DESC LIMIT 1",
    [validator]
  );
  if (res.rowCount == 0) {
    throw new Error("No such validator");
  } else {
    return res.rows[0];
  }
};
const getValidatorDesciption = async (validator: string) => {
  const db = getInstance();
  const res = await db.query(
    "SELECT * FROM validator_description WHERE validator_address=$1 ORDER BY height DESC LIMIT 1",
    [validator]
  );
  if (res.rowCount == 0) {
    throw new Error("No such validator");
  } else {
    return res.rows[0];
  }
};
const redelegate = async (
  delegator: string,
  validatorSrc: string,
  validatorDest: string,
  amount: Coin,
  height: number
) => {
  const db = getInstance();
  const res = await db.query(
    "SELECT to_json(amount), shares FROM staked_balances WHERE delegator=$1 AND validator=$2 ORDER BY height DESC LIMIT 1",
    [delegator, validatorSrc]
  );
  if (res.rowCount != 0) {
    const shares = await tokensToSharesAtHeight(
      BigInt(amount.amount),
      validatorSrc,
      height
    );
    const newAmount = (
      BigInt(res.rows[0].to_json.amount) - BigInt(amount.amount)
    ).toString();
    const newShares = BigNumber(res.rows[0].shares).minus(shares);
    await db.query(
      "INSERT INTO staked_balances(delegator, validator, amount, shares, height) VALUES($1,$2,$3::COIN,$4,$5)",
      [
        delegator,
        validatorSrc,
        '("' + amount.denom + '", "' + newAmount + '")',
        newShares.toPrecision(),
        height,
      ]
    );
  }
  await delegate(delegator, validatorDest, amount, height);
};
const updateSlashedValidator = async (
  validator: string,
  power: string,
  height: bigint
) => {
  const db = getInstance();
  const delegators = await db.query(
    "SELECT DISTINCT ON(delegator) delegator, validator, shares, height FROM staked_balances WHERE validator=$1 ORDER BY delegator, height DESC NULLS LAST",
    [validator]
  );
  if (delegators.rowCount && delegators.rowCount > 0) {
    for (let i = 0; i < delegators.rows.length; i++) {
      const delegation = delegators.rows[i];
      const { unbondingTime } = await getStakingParams(height);
      const unbondingHeight = await DB.getUnbondingHeight(
        height,
        parseInt((unbondingTime?.seconds ?? 0n).toString())
      );
      if (
        new BigNumber(delegation.shares).gt(0) ||
        (new BigNumber(delegation.shares).eq(0) &&
          BigInt(delegation.height) >= unbondingHeight)
      ) {
        await updateDelegatorDelegations(delegation.delegator, height);
      }
    }
  }
};
const updateDelegatorDelegations = async (
  delegator: string,
  height: bigint
) => {
  const db = getInstance();
  const q = QueryDelegatorDelegationsRequest.fromPartial({
    delegatorAddr: delegator,
  });
  const dels = QueryDelegatorDelegationsRequest.encode(q).finish();
  const delegations = QueryDelegatorDelegationsResponse.decode(
    await Utils.callABCI(
      "/cosmos.staking.v1beta1.Query/DelegatorDelegations",
      dels,
      parseInt(height.toString())
    )
  );

  if (delegations.delegationResponses.length > 0) {
    for (let j = 0; j < delegations.delegationResponses.length; j++) {
      const delegation = delegations.delegationResponses[j];
      const consensus_address = await getConsensusAddress(
        delegation.delegation?.validatorAddress ?? "",
        1
      );

      await db.query(
        "INSERT INTO staked_balances(delegator, validator, amount, shares, height) VALUES($1,$2,$3::COIN,$4,$5)",
        [
          delegator,
          consensus_address,
          '("' +
            delegation.balance?.denom +
            '", "' +
            delegation.balance?.amount +
            '")',
          new BigNumber(delegation.delegation?.shares ?? 0)
            .dividedBy(Math.pow(10, 18))
            .toPrecision(),
          height,
        ]
      );
    }
  }
};
const fetchAutoStake = async () => {
  const db = getInstance();
  const accounts = await db.query(
    "SELECT to_json(coins),address FROM balances"
  );
  if (accounts.rowCount && accounts.rowCount > 0) {
    for (let i = 0; i < accounts.rows.length; i++) {
      if (BigInt(accounts.rows[i].to_json[0].amount) > 25000000n) {
        const q = QueryDelegatorDelegationsRequest.fromPartial({
          delegatorAddr: accounts.rows[i].address,
        });
        const dels = QueryDelegatorDelegationsRequest.encode(q).finish();
        const delegations = QueryDelegatorDelegationsResponse.decode(
          await Utils.callABCI(
            "/cosmos.staking.v1beta1.Query/DelegatorDelegations",
            dels,
            1
          )
        );
        if (delegations.delegationResponses.length > 0) {
          for (let j = 0; j < delegations.delegationResponses.length; j++) {
            const delegation = delegations.delegationResponses[j];
            const consensus_address = await getConsensusAddress(
              delegation.delegation?.validatorAddress ?? "",
              1
            );

            await db.query(
              "INSERT INTO staked_balances(delegator, validator, amount, shares, height) VALUES($1,$2,$3::COIN,$4,$5)",
              [
                accounts.rows[i].address,
                consensus_address,
                '("' +
                  delegation.balance?.denom +
                  '", "' +
                  delegation.balance?.amount +
                  '")',
                new BigNumber(delegation.delegation?.shares ?? 0)
                  .dividedBy(Math.pow(10, 18))
                  .toPrecision(),
                1,
              ]
            );
          }
        }
      }
    }
  }
};
const delegate = async (
  delegator: string,
  validator: string,
  amount: Coin,
  height: number
) => {
  const db = getInstance();
  const val = validatorCache.get(validator);
  if (val) {
    const rate = BigNumber(val.tokens.toString()).dividedBy(
      val.delegator_shares
    );
    const delegator_shares = BigNumber(amount.amount).dividedBy(rate);
    const res = await db.query(
      "SELECT to_json(amount),shares FROM staked_balances WHERE delegator=$1 AND validator=$2 ORDER BY height DESC LIMIT 1",
      [delegator, validator]
    );
    if (res.rowCount == 0) {
      await db.query(
        "INSERT INTO staked_balances(delegator, validator, amount, shares, height) VALUES($1,$2,$3::COIN,$4, $5)",
        [
          delegator,
          validator,
          '("' + amount.denom + '", "' + amount.amount + '")',
          delegator_shares.toPrecision(),
          height,
        ]
      );
    } else {
      amount.amount = (
        BigInt(amount.amount) + BigInt(res.rows[0].to_json.amount)
      ).toString();
      const shares = new BigNumber(res.rows[0].shares).plus(delegator_shares);
      await db.query(
        "INSERT INTO staked_balances(delegator, validator, amount, shares, height) VALUES($1,$2,$3::COIN,$4, $5)",
        [
          delegator,
          validator,
          '("' + amount.denom + '", "' + amount.amount + '")',
          shares.toPrecision(),
          height,
        ]
      );
    }
  }
};
const checkAndSaveValidators = async (
  validators: Validator[],
  height: number
) => {
  const db = getInstance();
  for (let i = 0; i < validators.length; i++) {
    const val = validators[i];
    try {
      const consensus_address = await getConsensusAddress(
        val.operatorAddress,
        height
      );
      const cache = validatorCache.get(consensus_address);
      db.query({
        name: "save-validator-status",
        text: "INSERT INTO validator_status(validator_address, status, jailed, height) VALUES($1,$2,$3,$4)",
        values: [
          val.operatorAddress,
          bondStatusToJSON(val.status),
          val.jailed,
          height,
        ],
      });
      if (!cache || !(cache.tokens == BigInt(val.tokens))) {
        db.query({
          name: "save-validator-vp",
          text: "INSERT INTO validator_voting_power(validator_address, voting_power, delegator_shares, height) VALUES($1,$2,$3,$4)",
          values: [
            val.operatorAddress,
            val.tokens,
            BigNumber(val.delegatorShares)
              .dividedBy(Math.pow(10, 18))
              .toPrecision(),
            height,
          ],
        });
      }
      validatorCache.set(consensus_address, {
        status: bondStatusToJSON(val.status),
        jailed: val.jailed,
        tokens: BigInt(val.tokens),
        delegator_shares: BigNumber(val.delegatorShares).dividedBy(
          Math.pow(10, 18)
        ),
      });
    } catch (_e) {
      /* Validator created in this block */
    }
  }
};
const savePool = async (pool: Pool, height?: number) => {
  const db = getInstance();
  await db.query(
    "INSERT INTO staking_pool(bonded_tokens,not_bonded_tokens,height) VALUES($1,$2,$3) ON CONFLICT ON CONSTRAINT unique_pool DO NOTHING",
    [pool.bondedTokens, pool.notBondedTokens, height]
  );
};
export {
  checkAndSaveValidators,
  delegate,
  fetchAutoStake,
  getConsensusAddress,
  getValidatorCommission,
  getValidatorDesciption,
  redelegate,
  savePool,
  saveStakingParams,
  updateSlashedValidator,
};
