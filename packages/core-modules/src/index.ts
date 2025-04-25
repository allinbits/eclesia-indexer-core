import { IndexingModule } from "@clockwork-projects/indexer-engine/dist/types";

import { AuthModule } from "./cosmos.auth.v1beta1";
import { BankModule } from "./cosmos.bank.v1beta1";
import { StakingModule } from "./cosmos.staking.v1beta1";
export * as Blocks from "./blocks";
export { AuthModule } from "./cosmos.auth.v1beta1";
export { BankModule } from "./cosmos.bank.v1beta1";
export { StakingModule } from "./cosmos.staking.v1beta1";
export interface ModuleMap {
  "cosmos.auth.v1beta1": AuthModule;
  "cosmos.bank.v1beta1": BankModule;
  "cosmos.staking.v1beta1": StakingModule;
  [key: string]: IndexingModule;
}