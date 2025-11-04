/* eslint-disable max-lines */

import {
  createHash,
} from "node:crypto";
import * as fs from "node:fs";

import {
  GeneratedType,
} from "@cosmjs/proto-signing";
import {
  PgIndexer,
} from "@eclesia/basic-pg-indexer";
import {
  EcleciaIndexer, PAGINATION_LIMITS, Types,
} from "@eclesia/indexer-engine";
import {
  Utils,
} from "@eclesia/indexer-engine";
import BigNumber from "bignumber.js";
import {
  Coin,
} from "cosmjs-types/cosmos/base/v1beta1/coin.js";
import {
  PubKey as EdPubKey,
} from "cosmjs-types/cosmos/crypto/ed25519/keys.js";
import {
  PubKey as SecpPubKey,
} from "cosmjs-types/cosmos/crypto/secp256k1/keys.js";
import {
  QueryPoolRequest,
  QueryPoolResponse,
} from "cosmjs-types/cosmos/staking/v1beta1/query.js";
import {
  QueryDelegatorDelegationsRequest,
  QueryDelegatorDelegationsResponse,
  QueryValidatorDelegationsRequest,
  QueryValidatorDelegationsResponse,
} from "cosmjs-types/cosmos/staking/v1beta1/query.js";
import {
  bondStatusToJSON,
  Params as StakingParams,
  Pool,
  Validator,
} from "cosmjs-types/cosmos/staking/v1beta1/staking.js";
import {
  MsgBeginRedelegate,
  MsgCreateValidator,
  MsgDelegate,
  MsgEditValidator,
  MsgUndelegate,
} from "cosmjs-types/cosmos/staking/v1beta1/tx.js";
import {
  JSONStringify,
} from "json-with-bigint";

import {
  BankModule,
} from "../cosmos.bank.v1beta1/index.js";

/** Events emitted by the Staking module for various staking operations */
export type Events = {
  "/cosmos.staking.v1beta1.MsgEditValidator": {
    value: Types.TxResult<Uint8Array>
  }
  "/cosmos.staking.v1beta1.MsgCreateValidator": {
    value: Types.TxResult<Uint8Array>
  }
  "/cosmos.staking.v1beta1.MsgBeginRedelegate": {
    value: Types.TxResult<Uint8Array>
  }
  "/cosmos.staking.v1beta1.MsgDelegate": {
    value: Types.TxResult<Uint8Array>
  }
  "/cosmos.staking.v1beta1.MsgUndelegate": {
    value: Types.TxResult<Uint8Array>
  }

  "gentx/cosmos.staking.v1beta1.MsgCreateValidator": {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any
  }

  "genesis/value/app_state.staking.params": {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any
  }

  "genesis/array/app_state.staking.validators": {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any[]
  }
};

import * as path from "node:path";
import {
  fileURLToPath,
} from "node:url";

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Cached validator information for performance optimization */
export type CachedValidator = {
  status: string // Validator bond status (bonded, unbonded, unbonding)
  jailed: boolean // Whether validator is jailed
  tokens: bigint // Total tokens delegated to validator
  delegator_shares: BigNumber // Total shares issued by validator
};

/**
 * Cosmos SDK Staking module indexer that tracks validators, delegations, and staking operations
 * Handles validator creation, delegation changes, redelegations, and unbonding
 */
export class StakingModule implements Types.IndexingModule {
  indexer!: EcleciaIndexer;

  private pgIndexer!: PgIndexer;

  /** Registry of protobuf message types for decoding */
  private registry: [string, GeneratedType][];

  public name: string = "cosmos.staking.v1beta1";

  /** Depends on auth module for account management */
  public depends: string[] = ["cosmos.auth.v1beta1"];

  public provides: string[] = ["cosmos.staking.v1beta1"];

  /** Cache mapping operator addresses to consensus addresses */
  public validatorAddressCache = new Map<string, string>();

  /** Cache of validator status and delegation information */
  public validatorCache = new Map<string, CachedValidator>();

  constructor(registry: [string, GeneratedType][]) {
    this.registry = registry;
  }

  async cacheValidatorData() {
    const db = this.pgIndexer.getInstance();
    const res = await db.query("SELECT * FROM validator_infos");
    for (let i = 0; i < res.rows.length; i++) {
      this.validatorAddressCache.set(
        res.rows[i].operator_address, res.rows[i].consensus_address,
      );
    }
  }

  async setup() {
    await this.pgIndexer.beginTransaction();
    const client = this.pgIndexer.getInstance();
    const exists = await client.query(
      "SELECT EXISTS ( SELECT FROM pg_tables WHERE  schemaname = 'public' AND tablename  = 'staking_params')",
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

    await this.cacheValidatorData();
    await this.cacheLatestValidatorStatuses();
  }

  async init(pgIndexer: PgIndexer): Promise<void> {
    this.pgIndexer = pgIndexer;
    this.indexer = pgIndexer.indexer;
    const registryMap: Map<string, (typeof this.registry)[0][1]> = new Map();
    for (let i = 0; i < this.registry.length; i++) {
      registryMap.set(this.registry[i][0], this.registry[i][1]);
    }

    this.indexer.on(
      "gentx/cosmos.staking.v1beta1.MsgCreateValidator", async (event): Promise<void> => {
        const db = this.pgIndexer.getInstance();
        const consensus_address = Utils.chainAddressfromKeyhash(
          (process.env.CHAIN_PREFIX ?? "cosmos") + "valcons", createHash("sha256")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .update(Buffer.from((event.value.pubkey as any).key, "base64"))
            .digest("hex")
            .slice(0, 40),
        );
        const consensus_pubkey
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
          = (event.value.pubkey as any)["@type"]
            + "("
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
            + Buffer.from((event.value.pubkey as any).key, "base64").toString("hex")
            + ")";
        await db.query({
          name: "save-validator",
          text: "INSERT INTO validators(consensus_address,consensus_pubkey) VALUES ($1,$2)",
          values: [consensus_address, consensus_pubkey],
        });
        await db.query({
          name: "save-staked-balance-genesis",
          text: "INSERT INTO staked_balances(delegator,amount,shares,validator) VALUES($1,$2::COIN,$3,$4)",
          values: [
            event.value.delegator_address,
            "(\""
            + event.value.value.denom
            + "\", \""
            + event.value.value.amount
            + "\")",
            event.value.value.amount,
            consensus_address,
          ],
        });
        await db.query({
          name: "save-validator-info-genesis",
          text: "INSERT INTO validator_infos(consensus_address, operator_address, self_delegate_address, max_change_rate, max_rate) VALUES ($1,$2,$3,$4,$5)",
          values: [consensus_address, event.value.validator_address, event.value.delegator_address, event.value.commission.max_change_rate, event.value.commission.max_rate],
        });
        this.validatorAddressCache.set(
          event.value.validator_address, consensus_address,
        );
        await db.query({
          name: "save-validator-description-genesis",
          text: "INSERT INTO validator_descriptions(validator_address, moniker, identity, avatar_url,  website, security_contact, details) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          values: [event.value.validator_address, event.value.description.moniker, event.value.description.identity, event.value.description.identity, event.value.description.website, event.value.description.security_contact, event.value.description.details],
        });
        await db.query({
          name: "save-validator-commission-genesis",
          text: "INSERT INTO validator_commissions(validator_address, commission, min_self_delegation) VALUES ($1,$2,$3)",
          values: [event.value.validator_address, event.value.commission.rate, event.value.min_self_delegation],
        });

        if (this.pgIndexer.modules && this.pgIndexer.modules["cosmos.bank.v1beta1"]) {
        // Explicitly decrease validator self delegator balances since we have no events for these
          await (this.pgIndexer.modules["cosmos.bank.v1beta1"] as BankModule).decreaseBalance(
            event.value.delegator_address, event.value.value.amount + event.value.value.denom,
          );
        }

        this.indexer.log.silly(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "Value passed to genesis indexing module: " + JSONStringify((event as any).value),
        );
      },
    );
    this.indexer.on("/cosmos.staking.v1beta1.MsgEditValidator", async (event) => {
      const msg = MsgEditValidator.decode(event.value.tx);
      const db = this.pgIndexer.getInstance();

      const descr = await this.getValidatorDesciption(msg.validatorAddress);
      const commission = await this.getValidatorCommission(msg.validatorAddress);
      await db.query({
        name: "save-validator-description",
        text: "INSERT INTO validator_descriptions(validator_address, moniker, identity, avatar_url,  website, security_contact, details, height) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        values: [
          msg.validatorAddress,
          msg.description?.moniker && msg.description.moniker != "[do-not-modify]"
            ? msg.description?.moniker
            : descr.moniker,
          msg.description?.identity
          && msg.description.identity != "[do-not-modify]"
            ? msg.description?.identity
            : descr.identity,
          msg.description?.identity
          && msg.description.identity != "[do-not-modify]"
            ? msg.description?.identity
            : descr.identity,
          msg.description?.website && msg.description.website != "[do-not-modify]"
            ? msg.description?.website
            : descr.website,
          msg.description?.securityContact
          && msg.description.securityContact != "[do-not-modify]"
            ? msg.description?.securityContact
            : descr.security_contact,
          msg.description?.details && msg.description.details != "[do-not-modify]"
            ? msg.description?.details
            : descr.details,
          event.height,
        ],
      });
      await db.query({
        name: "save-validato-commission",
        text: "INSERT INTO validator_commissions(validator_address, commission, min_self_delegation, height) VALUES ($1,$2,$3,$4)",
        values: [
          msg.validatorAddress,
          msg.commissionRate == "" ? commission.commission : msg.commissionRate,
          msg.minSelfDelegation == ""
            ? commission.min_self_delegation
            : msg.minSelfDelegation,
          event.height,
        ],
      });
    });

    this.indexer.on(
      "/cosmos.staking.v1beta1.MsgCreateValidator", async (event): Promise<void> => {
        const db = this.pgIndexer.getInstance();
        const msg = MsgCreateValidator.decode(event.value.tx);
        const key
          = msg.pubkey?.typeUrl == "/cosmos.crypto.ed25519.PubKey"
            ? EdPubKey.decode(msg.pubkey.value)
            : SecpPubKey.decode(msg.pubkey?.value ?? new Uint8Array());
        const consensus_address = Utils.chainAddressfromKeyhash(
          (process.env.CHAIN_PREFIX ?? "cosmos") + "valcons", createHash("sha256").update(key.key).digest("hex").slice(0, 40),
        );
        const consensus_pubkey
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
          = (msg.pubkey as any)["typeUrl"]
            + "("
            + Buffer.from(key.key).toString("hex")
            + ")";
        await db.query({
          name: "save-validator",
          text: "INSERT INTO validators(consensus_address,consensus_pubkey) VALUES ($1,$2)",
          values: [consensus_address, consensus_pubkey],
        });
        if (msg.value) {
          await db.query({
            name: "save-staked-balance",
            text: "INSERT INTO staked_balances(delegator,amount,validator,shares, height) VALUES($1,$2::COIN,$3,$4,$5)",
            values: [msg.delegatorAddress, "(\"" + msg.value?.denom + "\", \"" + msg.value?.amount + "\")", consensus_address, msg.value?.amount, event.height],
          });
        }
        await db.query({
          name: "save-validator-info",
          text: "INSERT INTO validator_infos(consensus_address, operator_address, self_delegate_address, max_change_rate, max_rate,height) VALUES ($1,$2,$3,$4,$5,$6)",
          values: [consensus_address, msg.validatorAddress, msg.delegatorAddress, msg.commission?.maxChangeRate, msg.commission?.maxRate, event.height],
        });
        this.validatorAddressCache.set(msg.validatorAddress, consensus_address);
        if (msg.description) {
          await db.query({
            name: "save-validator-description",
            text: "INSERT INTO validator_descriptions(validator_address, moniker, identity, avatar_url,  website, security_contact, details, height) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            values: [msg.validatorAddress, msg.description?.moniker, msg.description?.identity, msg.description?.identity, msg.description?.website, msg.description?.securityContact, msg.description?.details, event.height],
          });

          await db.query({
            name: "save-validator-commission",
            text: "INSERT INTO validator_commissions(validator_address, commission, min_self_delegation, height) VALUES ($1,$2,$3,$4)",
            values: [msg.validatorAddress, msg.commission?.rate, msg.minSelfDelegation, event.height],
          });
        }
      },
    );
    this.indexer.on("/cosmos.staking.v1beta1.MsgBeginRedelegate", async (event) => {
      const msg = MsgBeginRedelegate.decode(event.value.tx);

      if (msg.amount && event.height) {
        await this.redelegate(
          msg.delegatorAddress, await this.getConsensusAddress(msg.validatorSrcAddress, event.height), await this.getConsensusAddress(msg.validatorDstAddress, event.height), msg.amount, event.height,
        );
      }
    });
    this.indexer.on("/cosmos.staking.v1beta1.MsgDelegate", async (event) => {
      const msg = MsgDelegate.decode(event.value.tx);
      if (msg.amount && event.height) {
        await this.delegate(
          msg.delegatorAddress, await this.getConsensusAddress(msg.validatorAddress, event.height), msg.amount, event.height,
        );
      }
    });
    this.indexer.on("/cosmos.staking.v1beta1.MsgUndelegate", async (event) => {
      const _msg = MsgUndelegate.decode(event.value.tx);
    });

    this.indexer.on("genesis/value/app_state.staking.params", async (event) => {
      const db = this.pgIndexer.getInstance();
      await db.query("INSERT INTO staking_params(params) VALUES($1)", [event.value]);
    });

    this.indexer.on("genesis/array/app_state.staking.validators", async (event) => {
      const db = this.pgIndexer.getInstance();
      const validators = event.value;
      for (let i = 0; i < validators.length; i++) {
        const validator = validators[i];
        const consensus_address = Utils.chainAddressfromKeyhash(
          (process.env.CHAIN_PREFIX ?? "cosmos") + "valcons", createHash("sha256")
            .update(Buffer.from(validator.consensus_pubkey.pubkey.key, "base64"))
            .digest("hex")
            .slice(0, 40),
        );
        const consensus_pubkey
          = validator.consensus_pubkey.pubkey["@type"]
            + "("
            + Buffer.from(validator.consensus_pubkey.pubkey.key, "base64").toString(
              "hex",
            )
            + ")";
        await db.query({
          name: "save-validator",
          text: "INSERT INTO validators(consensus_address,consensus_pubkey) VALUES ($1,$2)",
          values: [consensus_address, consensus_pubkey],
        });
        await db.query({
          name: "save-validator-info",
          text: "INSERT INTO validator_infos(consensus_address, operator_address, self_delegate_address, max_change_rate, max_rate,height) VALUES ($1,$2,$3,$4,$5,$6)",
          values: [
            consensus_address,
            validator.operator_address,
            Utils.chainAddressfromKeyhash(
              process.env.CHAIN_PREFIX ?? "cosmos", Utils.keyHashfromAddress(validator.operator_address),
            ),
            validator.commission.commission_rates.max_change_rate,
            validator.commission.commission_rates.max_rate,
            null,
          ],
        });
        this.validatorAddressCache.set(validator.operator_address, consensus_address);
        await db.query({
          name: "save-validator-description",
          text: "INSERT INTO validator_descriptions(validator_address, moniker, identity, avatar_url,  website, security_contact, details, height) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
          values: [validator.operator_address, validator.description?.moniker, validator.description?.identity, validator.description?.identity, validator.description?.website, validator.description?.security_contact, validator.description?.details, null],
        });

        await db.query({
          name: "save-validator-commission",
          text: "INSERT INTO validator_commissions(validator_address, commission, min_self_delegation, height) VALUES ($1,$2,$3,$4)",
          values: [validator.operator_address, validator.commission.commission_rates.rate, validator.min_self_delegation, null],
        });
      }
    });

    this.indexer.on("begin_block", async (event) => {
      if (event.height && event.value.validators) {
        await this.checkAndSaveValidators(event.value.validators, event.height);
      }
      // Handle auto-staking / fetch balances
      if (event.height == 1 && event.value.validators) {
        await this.fetchAutoStake(event.value.validators);
      }
      const slashEvents = event.value.events.filter(x => x.type == "slash");
      if (slashEvents.length > 0) {
        for (let i = 0; i < slashEvents.length; i++) {
          let val: string = "";
          let power: string = "";
          for (let j = 0; j < slashEvents[i].attributes.length; j++) {
            const key = Utils.decodeAttr(slashEvents[i].attributes[j].key);
            const value = Utils.decodeAttr(slashEvents[i].attributes[j].value);
            if (key == "address") {
              val = value ?? "";
            }
            if (key == "power") {
              power = value ?? "";
            }
          }
          await this.updateSlashedValidator(val, power, BigInt(event.height ?? 1));
        }
      }
    });

    this.indexer.on("periodic/1000", async (event) => {
      const q = QueryPoolRequest.fromPartial({
      });
      const poolreq = QueryPoolRequest.encode(q).finish();
      await this.indexer.callABCI(
        "/cosmos.staking.v1beta1.Query/Pool", poolreq, event.height,
      ).then(async (poolq) => {
        const pool = QueryPoolResponse.decode(poolq).pool;
        if (pool) {
          await this.savePool(pool, event.height);
        }
      }).catch((err) => {
        throw err;
      });
    });
  }

  async tokensToShares(amount: bigint, validator: string) {
    const val = this.validatorCache.get(validator);
    if (val) {
      const rate = new BigNumber(val.tokens.toString()).dividedBy(
        val.delegator_shares,
      );
      return new BigNumber(amount.toString()).dividedBy(rate);
    }
    else {
      throw new Error("Validator does not exist");
    }
  }

  async sharesToTokens(amount: string, validator: string) {
    const val = this.validatorCache.get(validator);
    if (val) {
      const rate = new BigNumber(val.tokens.toString()).dividedBy(
        val.delegator_shares,
      );
      return new BigNumber(amount).multipliedBy(rate).dp(0, 3);
    }
    else {
      throw new Error("Validator does not exist");
    }
  }

  async tokensToSharesAtHeight(
    amount: bigint,
    validator: string,
    height: number,
  ) {
    const db = this.pgIndexer.getInstance();
    const res = await db.query(
      "SELECT * FROM validator_voting_powers,validator_infos WHERE validator_address=validator_infos.operator_address AND validator_infos.consensus_address=$1 AND (validator_voting_powers.height<=$2 OR validator_voting_powers.height IS NULL) AND (validator_infos.height<=$2 OR validator_infos.height IS NULL) ORDER BY validator_voting_powers.height DESC NULLS LAST,validator_infos.height DESC NULLS LAST LIMIT 1", [validator, height],
    );
    if (res.rowCount && res.rowCount > 0) {
      const val = res.rows[0];
      const rate = new BigNumber(val.voting_power).dividedBy(
        val.delegator_shares,
      );
      return new BigNumber(amount.toString()).dividedBy(rate);
    }
    else {
      throw new Error("Validator does not exist");
    }
  }

  async sharesToTokensAtHeight(
    amount: number,
    validator: string,
    height: number,
  ) {
    const consensus_address = await this.getConsensusAddress(validator, 0);
    const db = this.pgIndexer.getInstance();
    const res = await db.query(
      "SELECT * FROM validator_voting_powers,validator_infos WHERE validator_address=validator_infos.operator_address AND validator_infos.consensus_address=$1 AND (validator_voting_powers.height<=$2 OR validator_voting_powers.height IS NULL) AND (validator_infos.height<=$2 OR validator_infos.height IS NULL) ORDER BY validator_voting_powers.height DESC NULLS LAST,validator_infos.height DESC NULLS LAST LIMIT 1", [consensus_address, height],
    );
    if (res.rowCount && res.rowCount > 0) {
      const val = res.rows[0];
      const rate = new BigNumber(val.voting_power).dividedBy(
        val.delegator_shares,
      );
      return new BigNumber(amount).multipliedBy(rate).dp(0, 3);
    }
    else {
      throw new Error("Validator does not exist");
    }
  }

  async saveStakingParams(params: StakingParams, height: number) {
    const db = this.pgIndexer.getInstance();
    await db.query(
      "INSERT INTO staking_params (params, height) VALUES ($1, $2)", [params, height],
    );
    this.indexer.log.verbose("Saved staking params at height: " + height);
  }

  async getStakingParams(height: bigint): Promise<StakingParams> {
    const db = this.pgIndexer.getInstance();
    const params = await db.query(
      "SELECT * FROM staking_params WHERE height<=$1 OR height IS null ORDER BY height DESC NULLS LAST LIMIT 1", [height],
    );
    if (params.rows.length > 0) {
      return params.rows[0].params as StakingParams;
    }
    else {
      throw new Error("No staking params");
    }
  }

  async getConsensusAddress(validator: string, _height: number) {
    const consensus_address = this.validatorAddressCache.get(validator);
    if (!consensus_address) {
      throw new Error("No consensus address");
    }
    else {
      return consensus_address;
    }
  }

  async getValidatorCommission(validator: string) {
    const db = this.pgIndexer.getInstance();
    const res = await db.query(
      "SELECT * FROM validator_commissions WHERE validator_address=$1 ORDER BY height DESC LIMIT 1", [validator],
    );
    if (res.rowCount == 0) {
      throw new Error("No such validator");
    }
    else {
      return res.rows[0];
    }
  }

  async getValidatorDesciption(validator: string) {
    const db = this.pgIndexer.getInstance();
    const res = await db.query(
      "SELECT * FROM validator_descriptions WHERE validator_address=$1 ORDER BY height DESC LIMIT 1", [validator],
    );
    if (res.rowCount == 0) {
      throw new Error("No such validator");
    }
    else {
      return res.rows[0];
    }
  }

  async redelegate(
    delegator: string,
    validatorSrc: string,
    validatorDest: string,
    amount: Coin,
    height: number,
  ) {
    const db = this.pgIndexer.getInstance();
    const res = await db.query(
      "SELECT to_json(amount), shares FROM staked_balances WHERE delegator=$1 AND validator=$2 ORDER BY height DESC LIMIT 1", [delegator, validatorSrc],
    );
    if (res.rowCount != 0) {
      const shares = await this.tokensToSharesAtHeight(
        BigInt(amount.amount), validatorSrc, height,
      );
      const newAmount = (
        BigInt(res.rows[0].to_json.amount) - BigInt(amount.amount)
      ).toString();
      const newShares = BigNumber(res.rows[0].shares).minus(shares);
      await db.query(
        "INSERT INTO staked_balances(delegator, validator, amount, shares, height) VALUES($1,$2,$3::COIN,$4,$5)", [delegator, validatorSrc, "(\"" + amount.denom + "\", \"" + newAmount + "\")", newShares.toPrecision(), height],
      );
    }
    await this.delegate(delegator, validatorDest, amount, height);
  }

  async getUnbondingHeight(
    height: bigint,
    unbondingPeriod: number,
  ): Promise<bigint> {
    const db = this.pgIndexer.getInstance();
    const timestamp = await db.query("SELECT * FROM blocks WHERE height=$1", [height]);
    if (timestamp.rowCount && timestamp.rowCount > 0) {
      const date = new Date(timestamp.rows[0].timestamp);
      const unbondingTime = new Date(date.getTime() - unbondingPeriod);
      const unbondingHeight = await db.query(
        "SELECT * FROM blocks WHERE timestamp<=$1 ORDER BY height desc LIMIT 1", [unbondingTime],
      );
      if (unbondingHeight.rowCount && unbondingHeight.rowCount > 0) {
        return BigInt(unbondingHeight.rows[0].height);
      }
      else {
        return 1n;
      }
    }
    else {
      throw new Error("Invalid block height");
    }
  }

  async updateSlashedValidator(
    validator: string,
    power: string,
    height: bigint,
  ) {
    const db = this.pgIndexer.getInstance();
    const delegators = await db.query(
      "SELECT DISTINCT ON(delegator) delegator, validator, shares, height FROM staked_balances WHERE validator=$1 ORDER BY delegator, height DESC NULLS LAST", [validator],
    );
    if (delegators.rowCount && delegators.rowCount > 0) {
      for (let i = 0; i < delegators.rows.length; i++) {
        const delegation = delegators.rows[i];
        const {
          unbondingTime,
        } = await this.getStakingParams(height);
        const unbondingHeight = await this.getUnbondingHeight(
          height, parseInt((unbondingTime?.seconds ?? 0n).toString()),
        );
        if (
          new BigNumber(delegation.shares).gt(0)
            || (new BigNumber(delegation.shares).eq(0)
              && BigInt(delegation.height) >= unbondingHeight)
        ) {
          await this.updateDelegatorDelegations(delegation.delegator, height);
        }
      }
    }
  }

  async updateDelegatorDelegations(
    delegator: string,
    height: bigint,
  ) {
    const db = this.pgIndexer.getInstance();
    const q = QueryDelegatorDelegationsRequest.fromPartial({
      delegatorAddr: delegator,
    });
    const dels = QueryDelegatorDelegationsRequest.encode(q).finish();
    const delegations = QueryDelegatorDelegationsResponse.decode(
      await this.indexer.callABCI(
        "/cosmos.staking.v1beta1.Query/DelegatorDelegations", dels, parseInt(height.toString()),
      ),
    );

    if (delegations.delegationResponses.length > 0) {
      for (let j = 0; j < delegations.delegationResponses.length; j++) {
        const delegation = delegations.delegationResponses[j];
        const consensus_address = await this.getConsensusAddress(
          delegation.delegation?.validatorAddress ?? "", 1,
        );

        await db.query(
          "INSERT INTO staked_balances(delegator, validator, amount, shares, height) VALUES($1,$2,$3::COIN,$4,$5)", [
            delegator,
            consensus_address,
            "(\""
            + delegation.balance?.denom
            + "\", \""
            + delegation.balance?.amount
            + "\")",
            new BigNumber(delegation.delegation?.shares ?? 0)
              .dividedBy(Math.pow(10, 18))
              .toPrecision(),
            height,
          ],
        );
      }
    }
  }

  async fetchAutoStake(validators: Validator[]) {
    const db = this.pgIndexer.getInstance();
    if (validators && validators.length > 0) {
      for (let i = 0; i < validators.length; i++) {
        let hasMore = true;
        let nextKey = null;
        while (hasMore) {
          const pagination = nextKey
            ? {
              limit: PAGINATION_LIMITS.DELEGATIONS,
              key: nextKey,
            }
            : {
              limit: PAGINATION_LIMITS.DELEGATIONS,
            };
          const q = QueryValidatorDelegationsRequest.fromPartial({
            validatorAddr: validators[i].operatorAddress,
            pagination,
          });
          const vals = QueryValidatorDelegationsRequest.encode(q).finish();
          const delegations = QueryValidatorDelegationsResponse.decode(
            await this.indexer.callABCI(
              "/cosmos.staking.v1beta1.Query/ValidatorDelegations", vals, 1,
            ),
          );
          if (
            delegations.pagination?.nextKey
            && delegations.pagination?.nextKey.length > 0
          ) {
            hasMore = true;
            nextKey = delegations.pagination.nextKey;
          }
          else {
            hasMore = false;
          }
          if (delegations.delegationResponses.length > 0) {
            for (let j = 0; j < delegations.delegationResponses.length; j++) {
              const delegation = delegations.delegationResponses[j];
              const consensus_address = await this.getConsensusAddress(
                delegation.delegation?.validatorAddress ?? "", 1,
              );

              await db.query(
                "INSERT INTO staked_balances(delegator, validator, amount, shares, height) VALUES($1,$2,$3::COIN,$4,$5)", [
                  delegation.delegation.delegatorAddress,
                  consensus_address,
                  "(\""
                  + delegation.balance?.denom
                  + "\", \""
                  + delegation.balance?.amount
                  + "\")",
                  new BigNumber(delegation.delegation?.shares ?? 0)
                    .dividedBy(Math.pow(10, 18))
                    .toPrecision(),
                  1,
                ],
              );
            }
          }
        }
      }
    }
  }

  async delegate(
    delegator: string,
    validator: string,
    amount: Coin,
    height: number,
  ) {
    const db = this.pgIndexer.getInstance();
    const val = this.validatorCache.get(validator);
    if (val) {
      const rate = BigNumber(val.tokens.toString()).dividedBy(
        val.delegator_shares,
      );
      const delegator_shares = BigNumber(amount.amount).dividedBy(rate);
      const res = await db.query(
        "SELECT to_json(amount),shares FROM staked_balances WHERE delegator=$1 AND validator=$2 ORDER BY height DESC LIMIT 1", [delegator, validator],
      );
      if (res.rowCount == 0) {
        await db.query(
          "INSERT INTO staked_balances(delegator, validator, amount, shares, height) VALUES($1,$2,$3::COIN,$4, $5)", [delegator, validator, "(\"" + amount.denom + "\", \"" + amount.amount + "\")", delegator_shares.toPrecision(), height],
        );
      }
      else {
        amount.amount = (
          BigInt(amount.amount) + BigInt(res.rows[0].to_json.amount)
        ).toString();
        const shares = new BigNumber(res.rows[0].shares).plus(delegator_shares);
        await db.query(
          "INSERT INTO staked_balances(delegator, validator, amount, shares, height) VALUES($1,$2,$3::COIN,$4, $5)", [delegator, validator, "(\"" + amount.denom + "\", \"" + amount.amount + "\")", shares.toPrecision(), height],
        );
      }
    }
  }

  async getLatestValidatorVotingPower(validator: string) {
    const db = this.pgIndexer.getInstance();
    const res = await db.query(
      "SELECT * FROM validator_voting_powers WHERE validator_address=$1 ORDER BY validator_voting_powers.height DESC NULLS LAST LIMIT 1", [validator],
    );
    return res.rowCount && res.rowCount > 0 ? res.rows[0] : null;
  }

  async cacheLatestValidatorStatuses() {
    const db = this.pgIndexer.getInstance();
    const res = await db.query(
      "SELECT DISTINCT ON(validator_address) validator_address, jailed, status, height FROM validator_status ORDER BY validator_address, height DESC NULLS LAST",
    );
    if (res.rowCount) {
      for (let i = 0; i < res.rowCount; i++) {
        const vp = await this.getLatestValidatorVotingPower(res.rows[i].validator_address);
        const row = res.rows[i];
        this.validatorCache.set(row.validator_address, {
          status: row.status,
          jailed: row.jailed,
          tokens: BigInt(vp ? vp["voting_power"] : 0),
          delegator_shares: BigNumber(vp ? vp["delegator_shares"] : 0),
        });
      }
    }
  }

  async checkAndSaveValidators(
    validators: Validator[],
    height: number,
  ) {
    const db = this.pgIndexer.getInstance();
    for (let i = 0; i < validators.length; i++) {
      const val = validators[i];
      try {
        const consensus_address = await this.getConsensusAddress(
          val.operatorAddress, height,
        );
        const cache = this.validatorCache.get(consensus_address);
        if (!cache || cache.status != bondStatusToJSON(val.status) || cache.jailed != val.jailed) {
          await db.query({
            name: "save-validator-status",
            text: "INSERT INTO validator_status(validator_address, status, jailed, height) VALUES($1,$2,$3,$4)",
            values: [val.operatorAddress, bondStatusToJSON(val.status), val.jailed, height],
          });
        }
        if (!cache || !(cache.tokens == BigInt(val.tokens))) {
          await db.query({
            name: "save-validator-vp",
            text: "INSERT INTO validator_voting_powers(validator_address, voting_power, delegator_shares, height) VALUES($1,$2,$3,$4)",
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
        this.validatorCache.set(consensus_address, {
          status: bondStatusToJSON(val.status),
          jailed: val.jailed,
          tokens: BigInt(val.tokens),
          delegator_shares: BigNumber(val.delegatorShares).dividedBy(
            Math.pow(10, 18),
          ),
        });
      }
      catch (_e) {
        // Validator may have been created in this block and not yet cached
        this.indexer.log.debug(`Validator ${val.operatorAddress} not found in cache, likely created in current block`);
      }
    }
  }

  async savePool(pool: Pool, height?: number) {
    const db = this.pgIndexer.getInstance();
    await db.query(
      "INSERT INTO staking_pool(bonded_tokens,not_bonded_tokens,height) VALUES($1,$2,$3) ON CONFLICT ON CONSTRAINT unique_pool DO NOTHING", [pool.bondedTokens, pool.notBondedTokens, height],
    );
  }
}
