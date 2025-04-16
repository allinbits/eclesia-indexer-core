import { Types } from "@eclesia/indexer";

import * as Auth from "./cosmos.auth.v1beta1";
import * as Bank from "./cosmos.bank.v1beta1";
import * as Staking from "./cosmos.staking.v1beta1";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface EventMap
    extends EventMap {}
}
