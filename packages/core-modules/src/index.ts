import {
  Types,
} from "@eclesia/indexer-engine";

import {
  AuthModule, Events as AuthEvents,
} from "./cosmos.auth.v1beta1/index.js";
import {
  BankModule, Events as BankEvents,
} from "./cosmos.bank.v1beta1/index.js";
import {
  Events as StakingEvents, StakingModule,
} from "./cosmos.staking.v1beta1/index.js";

/**
 * Extends the engine's global EventMap with every event these modules emit, so consumers get
 * typed handlers for module events without declaring anything themselves. Declared here rather
 * than in an ambient .d.ts so it is emitted into the published declarations.
 */
declare global {
  interface EventMap extends AuthEvents, BankEvents, StakingEvents, Types.Events {
  }
}
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
