import { Types } from "@eclesia/indexer-engine";

import * as Auth from "./cosmos.auth.v1beta1";
import * as Bank from "./cosmos.bank.v1beta1";
import * as Staking from "./cosmos.staking.v1beta1";

declare global {
  export interface EventMap
    extends Auth.Events,
    Bank.Events,
    Staking.Events,
    Types.Events {}
}