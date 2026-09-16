import type {
  Events,
} from "./types.js";

export {
  cosmos, CosmosAdapter, type CosmosAdapterOptions,
} from "./adapter.js";
export * as Mocks from "./mocks/index.js";
export type {
  CosmosBlock, Events as CosmosEvents, TxResult,
} from "./types.js";

/**
 * Adds the Cosmos block-level events to the engine's global EventMap, so any project that
 * imports this adapter gets typed `block`, `begin_block`, `tx_events`, `tx_memo` and
 * `end_block` handlers. Declared here rather than in an ambient .d.ts so it is emitted into
 * the published declarations.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface EventMap extends Events {
  }
}
