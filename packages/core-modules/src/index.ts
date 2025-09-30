import {
  Types,
} from "@eclesia/indexer-engine";

import {
  AuthModule,
} from "./cosmos.auth.v1beta1/index.js";
import {
  BankModule,
} from "./cosmos.bank.v1beta1/index.js";
import {
  StakingModule,
} from "./cosmos.staking.v1beta1/index.js";
export * as Blocks from "./blocks/index.js";
export {
  AuthModule,
} from "./cosmos.auth.v1beta1/index.js";
export {
  BankModule,
} from "./cosmos.bank.v1beta1/index.js";
export {
  StakingModule,
} from "./cosmos.staking.v1beta1/index.js";
export interface ModuleMap {
  "cosmos.auth.v1beta1": AuthModule
  "cosmos.bank.v1beta1": BankModule
  "cosmos.staking.v1beta1": StakingModule
  [key: string]: Types.IndexingModule
}
