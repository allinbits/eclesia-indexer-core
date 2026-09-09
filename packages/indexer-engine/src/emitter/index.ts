import {
  EventEmitter,
} from "node:events";

import {
  WithHeightAndUUID,
} from "../types/index.js";

/**
 * Custom event emitter that provides type-safe event handling for blockchain indexing
 * Extends Node.js EventEmitter with UUID tracking and error handling capabilities
 */
export class EclesiaEmitter {
  /** Internal Node.js EventEmitter instance */
  private emitter = new EventEmitter();

  /** Map tracking the number of handlers registered for each event type */
  public handled = new Map<string, number>();

  /** Wrappers registered per handler and event name, so off() removes exactly what on() added */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlerMap = new WeakMap<object, Map<string, Array<(eventData: any) => Promise<void>>>>();

  /** Raw handlers per event name in registration order, for callers that await them one by one */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private rawHandlers = new Map<string, Array<(eventData: any) => unknown>>();

  /**
   * Handlers registered for an event, in registration order.
   * @param eventName - Event name
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handlersFor(eventName: string): ReadonlyArray<(eventData: any) => unknown> {
    return this.rawHandlers.get(eventName) ?? [];
  }

  /**
   * Creates a new EclesiaEmitter instance
   * Sets max listeners to 0 (unlimited) to handle many modules
   */
  constructor() {
    this.emitter.setMaxListeners(0);
  }

  emit<EType extends keyof (WithHeightAndUUID<EventMap>) & string>(
    eventName: EType,
    eventArg: WithHeightAndUUID<EventMap>[EType] & {
      uuid?: string
    },
  ) {
    if (this.handled.has(eventName)) {
      this.emitter.emit(
        eventName, eventArg,
      );
    }
    else {
      this.emitter.emit(
        "_unhandled", {
          type: eventName as string,
          event: eventArg,
          uuid: eventArg.uuid,
        },
      );
    }
  }

  on<TEventName extends keyof WithHeightAndUUID<EventMap> & string | "_unhandled">(
    eventName: TEventName,
    handler: TEventName extends "_unhandled"
      ? (eventArg: {
        type: string
        event: unknown
        uuid: string
      }) => void
      : (eventArg: TEventName extends keyof WithHeightAndUUID<EventMap> ? WithHeightAndUUID<EventMap>[TEventName] : never) => void,
  ) {
    const count = this.handled.get(eventName);
    if (count) {
      this.handled.set(
        eventName, count + 1,
      );
    }
    else {
      this.handled.set(
        eventName, 1,
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapper = async (eventData: any) => {
      try {
        await handler(eventData);
        if (eventName !== "uuid" && eventName !== "_unhandled" && eventData.uuid) {
          this.emit(
            "uuid", {
              status: true,
              uuid: eventData.uuid,
            },
          );
        }
      }
      catch (error) {
        if (eventName !== "uuid" && eventName !== "_unhandled" && eventData.uuid) {
          this.emit(
            "uuid", {
              status: false,
              error: error as string,
              uuid: eventData.uuid,
            },
          );
        }
      }
    };
    const byEvent = this.handlerMap.get(handler) ?? new Map();
    const wrappers = byEvent.get(eventName) ?? [];
    wrappers.push(wrapper);
    byEvent.set(eventName, wrappers);
    this.handlerMap.set(handler, byEvent);
    const raw = this.rawHandlers.get(eventName) ?? [];
    raw.push(handler as (eventData: unknown) => unknown);
    this.rawHandlers.set(eventName, raw);
    this.emitter.on(
      eventName, wrapper,
    );
  }

  off<TEventName extends keyof WithHeightAndUUID<EventMap> & string>(
    eventName: TEventName,
    handler: (eventArg: WithHeightAndUUID<EventMap>[TEventName]) => void,
  ) {
    const wrappers = this.handlerMap.get(handler)?.get(eventName);
    if (!wrappers || wrappers.length === 0) {
      // Never registered for this event: nothing to remove, and the handled count must not
      // drop, or emit() would route to _unhandled while real handlers are still attached
      return;
    }
    const wrapper = wrappers.pop()!;
    this.emitter.off(
      eventName, wrapper,
    );
    const raw = this.rawHandlers.get(eventName) ?? [];
    const index = raw.lastIndexOf(handler as (eventData: unknown) => unknown);
    if (index >= 0) {
      raw.splice(index, 1);
    }
    const count = this.handled.get(eventName);
    if (count && count > 1) {
      this.handled.set(
        eventName, count - 1,
      );
    }
    else {
      this.handled.delete(eventName);
    }
  }
}
