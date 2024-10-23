/* eslint-disable max-lines-per-function */
/* eslint-disable max-lines */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { Utils } from "@eclesia/indexer";
import { bus, log } from "@eclesia/indexer/dist/bus";
import { getInstance } from "@eclesia/indexer/dist/db";
import { TxResult } from "@eclesia/indexer/dist/types";
import {
  chainAddressfromKeyhash,
  keyHashfromAddress,
} from "@eclesia/indexer/dist/utils/bech32";
import { decodeAttr } from "@eclesia/indexer/dist/utils/text";
import BigNumber from "bignumber.js";
import { PubKey as EdPubKey } from "cosmjs-types/cosmos/crypto/ed25519/keys";
import { PubKey as SecpPubKey } from "cosmjs-types/cosmos/crypto/ed25519/keys";
import {
  QueryPoolRequest,
  QueryPoolResponse,
} from "cosmjs-types/cosmos/staking/v1beta1/query";
import {
  MsgBeginRedelegate,
  MsgCreateValidator,
  MsgDelegate,
  MsgEditValidator,
  MsgUndelegate,
} from "cosmjs-types/cosmos/staking/v1beta1/tx";

import { decreaseBalance } from "../cosmos.bank.v1beta1/queries";
import {
  checkAndSaveValidators,
  delegate,
  fetchAutoStake,
  getConsensusAddress,
  getValidatorCommission,
  getValidatorDesciption,
  redelegate,
  savePool,
  updateSlashedValidator,
} from "./queries";

export type Events = {
  "/cosmos.staking.v1beta1.MsgEditValidator": { value: TxResult<Uint8Array> };
  "/cosmos.staking.v1beta1.MsgCreateValidator": { value: TxResult<Uint8Array> };
  "/cosmos.staking.v1beta1.MsgBeginRedelegate": { value: TxResult<Uint8Array> };
  "/cosmos.staking.v1beta1.MsgDelegate": { value: TxResult<Uint8Array> };
  "/cosmos.staking.v1beta1.MsgUndelegate": { value: TxResult<Uint8Array> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "gentx/cosmos.staking.v1beta1.MsgCreateValidator": { value: any };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "genesis/value/app_state.staking.params": { value: any };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "genesis/array/app_state.staking.validators": { value: any };
};
const migrate = async () => {
  const client = await getInstance();
  try {
    const latestMigrationQuery = await client.query(
      "SELECT * FROM migrations WHERE module=$1 ORDER BY dt DESC LIMIT 1",
      [name]
    );
    if (fs.existsSync(__dirname + "/migrations")) {
      const latestMigration =
        latestMigrationQuery.rowCount && latestMigrationQuery.rowCount > 0
          ? latestMigrationQuery.rows[0].dt
          : "0";
      const files = fs.readdirSync(__dirname + "/migrations").sort();
      for (let i = 0; i < files.length; i++) {
        if (path.extname(files[i]) == ".js") {
          const dt = path.basename(files[i], ".js");
          if (Number(dt) > Number(latestMigration)) {
            const migrationPath = __dirname + "/migrations/" + files[i];
            const migration = await import(migrationPath);
            log.info("Running migration: (" + name + ") " + migrationPath);
            await migration.run(client);
            await client.query(
              "INSERT INTO migrations(module,dt) VALUES ($1,$2);",
              [name, dt]
            );
          }
        }
      }
    }
  } catch (e) {
    log.error("" + e);
    throw e;
  }
};
const setupDB = async () => {
  const db = getInstance();
  const exists = await db.query(
    "SELECT EXISTS ( SELECT FROM pg_tables WHERE  schemaname = 'public' AND tablename  = 'staking_params')"
  );
  if (!exists.rows[0].exists) {
    try {
      const module = fs.readFileSync(__dirname + "/module.sql").toString();
      await db.query(module);
    } catch (e) {
      throw new Error("Could not init module staking: " + e);
    }
  }
  try {
    await migrate();
  } catch (_e) {
    throw new Error("Could not migrate module: " + name);
  }
};
export const name = "cosmos.staking.v1beta1";
export type CachedValidator = {
  status: string;
  jailed: boolean;
  tokens: bigint;
  delegator_shares: BigNumber;
};
export const validatorAddressCache = new Map<string, string>();
export const validatorCache = new Map<string, CachedValidator>();
const cacheValidatorData = async () => {
  const db = getInstance();
  const res = await db.query("SELECT * FROM validator_info");
  for (let i = 0; i < res.rows.length; i++) {
    validatorAddressCache.set(
      res.rows[i].operator_address,
      res.rows[i].consensus_address
    );
  }
};
export const init = async (modules?: string[]) => {
  await setupDB();
  await cacheValidatorData();

  bus.on(
    "gentx/cosmos.staking.v1beta1.MsgCreateValidator",
    async (event): Promise<void> => {
      const db = getInstance();
      const consensus_address = chainAddressfromKeyhash(
        (process.env.CHAIN_PREFIX ?? "cosmos") + "valcons",
        createHash("sha256")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update(Buffer.from((event.value.pubkey as any).key, "base64"))
          .digest("hex")
          .slice(0, 40)
      );
      const consensus_pubkey =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (event.value.pubkey as any)["@type"] +
        "(" +
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Buffer.from((event.value.pubkey as any).key, "base64").toString("hex") +
        ")";
      await db.query({
        name: "save-validator",
        text: "INSERT INTO validator(consensus_address,consensus_pubkey) VALUES ($1,$2)",
        values: [consensus_address, consensus_pubkey],
      });
      await db.query({
        name: "save-staked-balance-genesis",
        text: "INSERT INTO staked_balances(delegator,amount,shares,validator) VALUES($1,$2::COIN,$3,$4)",
        values: [
          event.value.delegator_address,
          '("' +
            event.value.value.denom +
            '", "' +
            event.value.value.amount +
            '")',
          event.value.value.amount,
          consensus_address,
        ],
      });
      await db.query({
        name: "save-validator-info-genesis",
        text: "INSERT INTO validator_info(consensus_address, operator_address, self_delegate_address, max_change_rate, max_rate) VALUES ($1,$2,$3,$4,$5)",
        values: [
          consensus_address,
          event.value.validator_address,
          event.value.delegator_address,
          event.value.commission.max_change_rate,
          event.value.commission.max_rate,
        ],
      });
      validatorAddressCache.set(
        event.value.validator_address,
        consensus_address
      );
      await db.query({
        name: "save-validator-description-genesis",
        text: "INSERT INTO validator_description(validator_address, moniker, identity, avatar_url,  website, security_contact, details) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        values: [
          event.value.validator_address,
          event.value.description.moniker,
          event.value.description.identity,
          event.value.description.identity,
          event.value.description.website,
          event.value.description.security_contact,
          event.value.description.details,
        ],
      });
      await db.query({
        name: "save-validator-commission-genesis",
        text: "INSERT INTO validator_commission(validator_address, commission, min_self_delegation) VALUES ($1,$2,$3)",
        values: [
          event.value.validator_address,
          event.value.commission.rate,
          event.value.min_self_delegation,
        ],
      });

      if (modules && modules.includes("cosmos.bank.v1beta1")) {
        // Explicitly decrease validator self delegator balances since we have no events for these
        await decreaseBalance(
          event.value.delegator_address,
          event.value.value.amount + event.value.value.denom
        );
      }

      log.verbose(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "Value passed to genesis indexing module: " + (event as any).value
      );

      if (event.uuid) {
        bus.emit("uuid", { status: true, uuid: event.uuid });
      }
    }
  );
  bus.on("/cosmos.staking.v1beta1.MsgEditValidator", async (event) => {
    const msg = MsgEditValidator.decode(event.value.tx);
    const db = getInstance();

    const descr = await getValidatorDesciption(msg.validatorAddress);
    const commission = await getValidatorCommission(msg.validatorAddress);
    await db.query({
      name: "save-validator-description",
      text: "INSERT INTO validator_description(validator_address, moniker, identity, avatar_url,  website, security_contact, details, height) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      values: [
        msg.validatorAddress,
        msg.description?.moniker && msg.description.moniker != "[do-not-modify]"
          ? msg.description?.moniker
          : descr.moniker,
        msg.description?.identity &&
        msg.description.identity != "[do-not-modify]"
          ? msg.description?.identity
          : descr.identity,
        msg.description?.identity &&
        msg.description.identity != "[do-not-modify]"
          ? msg.description?.identity
          : descr.identity,
        msg.description?.website && msg.description.website != "[do-not-modify]"
          ? msg.description?.website
          : descr.website,
        msg.description?.securityContact &&
        msg.description.securityContact != "[do-not-modify]"
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
      text: "INSERT INTO validator_commission(validator_address, commission, min_self_delegation, height) VALUES ($1,$2,$3,$4)",
      values: [
        msg.validatorAddress,
        msg.commissionRate == "" ? commission.commission : msg.commissionRate,
        msg.minSelfDelegation == ""
          ? commission.min_self_delegation
          : msg.minSelfDelegation,
        event.height,
      ],
    });
    if (event.uuid) {
      bus.emit("uuid", { status: true, uuid: event.uuid });
    }
  });

  bus.on(
    "/cosmos.staking.v1beta1.MsgCreateValidator",
    async (event): Promise<void> => {
      const db = getInstance();
      const msg = MsgCreateValidator.decode(event.value.tx);
      const key =
        msg.pubkey?.typeUrl == "/cosmos.crypto.ed25519.PubKey"
          ? EdPubKey.decode(msg.pubkey.value)
          : SecpPubKey.decode(msg.pubkey?.value ?? new Uint8Array());
      const consensus_address = chainAddressfromKeyhash(
        (process.env.CHAIN_PREFIX ?? "cosmos") + "valcons",
        createHash("sha256").update(key.key).digest("hex").slice(0, 40)
      );
      const consensus_pubkey =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (msg.pubkey as any)["typeUrl"] +
        "(" +
        Buffer.from(key.key).toString("hex") +
        ")";
      await db.query({
        name: "save-validator",
        text: "INSERT INTO validator(consensus_address,consensus_pubkey) VALUES ($1,$2)",
        values: [consensus_address, consensus_pubkey],
      });
      if (msg.value) {
        await db.query({
          name: "save-staked-balance",
          text: "INSERT INTO staked_balances(delegator,amount,validator,shares, height) VALUES($1,$2::COIN,$3,$4,$5)",
          values: [
            msg.delegatorAddress,
            '("' + msg.value?.denom + '", "' + msg.value?.amount + '")',
            consensus_address,
            msg.value?.amount,
            event.height,
          ],
        });
      }
      await db.query({
        name: "save-validator-info",
        text: "INSERT INTO validator_info(consensus_address, operator_address, self_delegate_address, max_change_rate, max_rate,height) VALUES ($1,$2,$3,$4,$5,$6)",
        values: [
          consensus_address,
          msg.validatorAddress,
          msg.delegatorAddress,
          msg.commission?.maxChangeRate,
          msg.commission?.maxRate,
          event.height,
        ],
      });
      validatorAddressCache.set(msg.validatorAddress, consensus_address);
      if (msg.description) {
        await db.query({
          name: "save-validator-description",
          text: "INSERT INTO validator_description(validator_address, moniker, identity, avatar_url,  website, security_contact, details, height) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
          values: [
            msg.validatorAddress,
            msg.description?.moniker,
            msg.description?.identity,
            msg.description?.identity,
            msg.description?.website,
            msg.description?.securityContact,
            msg.description?.details,
            event.height,
          ],
        });

        await db.query({
          name: "save-validator-commission",
          text: "INSERT INTO validator_commission(validator_address, commission, min_self_delegation, height) VALUES ($1,$2,$3,$4)",
          values: [
            msg.validatorAddress,
            msg.commission?.rate,
            msg.minSelfDelegation,
            event.height,
          ],
        });
      }

      if (event.uuid) {
        bus.emit("uuid", { status: true, uuid: event.uuid });
      }
    }
  );
  bus.on("/cosmos.staking.v1beta1.MsgBeginRedelegate", async (event) => {
    const msg = MsgBeginRedelegate.decode(event.value.tx);

    if (msg.amount && event.height) {
      await redelegate(
        msg.delegatorAddress,
        await getConsensusAddress(msg.validatorSrcAddress, event.height),
        await getConsensusAddress(msg.validatorDstAddress, event.height),
        msg.amount,
        event.height
      );
    }
    if (event.uuid) {
      bus.emit("uuid", { status: true, uuid: event.uuid });
    }
  });
  bus.on("/cosmos.staking.v1beta1.MsgDelegate", async (event) => {
    const msg = MsgDelegate.decode(event.value.tx);
    if (msg.amount && event.height) {
      await delegate(
        msg.delegatorAddress,
        await getConsensusAddress(msg.validatorAddress, event.height),
        msg.amount,
        event.height
      );
    }
    if (event.uuid) {
      bus.emit("uuid", { status: true, uuid: event.uuid });
    }
  });
  bus.on("/cosmos.staking.v1beta1.MsgUndelegate", async (event) => {
    const _msg = MsgUndelegate.decode(event.value.tx);

    //const db = getInstance();

    if (event.uuid) {
      bus.emit("uuid", { status: true, uuid: event.uuid });
    }
  });

  bus.on("genesis/value/app_state.staking.params", async (event) => {
    const db = getInstance();
    await db.query("INSERT INTO staking_params(params) VALUES($1)", [
      event.value,
    ]);

    if (event.uuid) {
      bus.emit("uuid", { status: true, uuid: event.uuid });
    }
  });

  bus.on("genesis/array/app_state.staking.validators", async (event) => {
    const db = getInstance();
    const validator = event.value;
    const consensus_address = chainAddressfromKeyhash(
      (process.env.CHAIN_PREFIX ?? "cosmos") + "valcons",
      createHash("sha256")
        .update(Buffer.from(validator.consensus_pubkey.pubkey.key, "base64"))
        .digest("hex")
        .slice(0, 40)
    );
    const consensus_pubkey =
      validator.consensus_pubkey.pubkey["@type"] +
      "(" +
      Buffer.from(validator.consensus_pubkey.pubkey.key, "base64").toString(
        "hex"
      ) +
      ")";
    await db.query({
      name: "save-validator",
      text: "INSERT INTO validator(consensus_address,consensus_pubkey) VALUES ($1,$2)",
      values: [consensus_address, consensus_pubkey],
    });
    await db.query({
      name: "save-validator-info",
      text: "INSERT INTO validator_info(consensus_address, operator_address, self_delegate_address, max_change_rate, max_rate,height) VALUES ($1,$2,$3,$4,$5,$6)",
      values: [
        consensus_address,
        validator.operator_address,
        chainAddressfromKeyhash(
          process.env.CHAIN_PREFIX ?? "cosmos",
          keyHashfromAddress(validator.operator_address)
        ),
        validator.commission.commission_rates.max_change_rate,
        validator.commission.commission_rates.max_rate,
        null,
      ],
    });
    validatorAddressCache.set(validator.operator_address, consensus_address);
    await db.query({
      name: "save-validator-description",
      text: "INSERT INTO validator_description(validator_address, moniker, identity, avatar_url,  website, security_contact, details, height) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      values: [
        validator.operator_address,
        validator.description?.moniker,
        validator.description?.identity,
        validator.description?.identity,
        validator.description?.website,
        validator.description?.security_contact,
        validator.description?.details,
        null,
      ],
    });

    await db.query({
      name: "save-validator-commission",
      text: "INSERT INTO validator_commission(validator_address, commission, min_self_delegation, height) VALUES ($1,$2,$3,$4)",
      values: [
        validator.operator_address,
        validator.commission.commission_rates.rate,
        validator.min_self_delegation,
        null,
      ],
    });
    if (event.uuid) {
      bus.emit("uuid", { status: true, uuid: event.uuid });
    }
  });

  bus.on("begin_block", async (event) => {
    if (event.height) {
      await checkAndSaveValidators(event.value.validators, event.height);
    }
    // Handle auto-staking / fetch balances
    if (event.height == 1 && process.env.AUTOSTAKE == "1") {
      await fetchAutoStake();
    }
    const slashEvents = event.value.events.filter((x) => x.type == "slash");
    if (slashEvents.length > 0) {
      for (let i = 0; i < slashEvents.length; i++) {
        let val: string = "";
        let power: string = "";
        for (let j = 0; j < slashEvents[i].attributes.length; j++) {
          const key = decodeAttr(slashEvents[i].attributes[j].key);
          const value = decodeAttr(slashEvents[i].attributes[j].value);
          if (key == "address") {
            val = value;
          }
          if (key == "power") {
            power = value;
          }
        }
        await updateSlashedValidator(val, power, BigInt(event.height ?? 1));
      }
    }
    if (event.uuid) {
      bus.emit("uuid", { status: true, uuid: event.uuid });
    }
  });

  bus.on("periodic/100", async (event) => {
    const q = QueryPoolRequest.fromPartial({});
    const poolreq = QueryPoolRequest.encode(q).finish();
    try {
      Utils.callABCI(
        "/cosmos.staking.v1beta1.Query/Pool",
        poolreq,
        event.height
      ).then(async (poolq) => {
        const pool = QueryPoolResponse.decode(poolq).pool;
        if (pool) {
          await savePool(pool, event.height);
        }
      });

      if (event.uuid) {
        bus.emit("uuid", { status: true, uuid: event.uuid });
      }
    } catch (_e) {
      if (event.uuid) {
        bus.emit("uuid", { status: false, uuid: event.uuid });
      }
    }
  });
};
export const depends = ["cosmos.auth.v1beta1", "cosmos.bank.v1beta1"];
export const provides = [name];
