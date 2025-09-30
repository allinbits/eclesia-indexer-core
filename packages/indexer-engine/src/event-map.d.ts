import {
  Events,
} from "./types";

/**
 * Global event map declaration for type-safe event handling
 * This interface can be extended by modules to add their own event types
 * Provides compile-time type checking for event names and payloads
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface EventMap extends Events {
  }
}
