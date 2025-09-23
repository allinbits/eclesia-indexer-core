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

  /** WeakMap storing wrapper functions for proper cleanup */
  private handlerMap = new WeakMap();

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
    this.handlerMap.set(
      handler, wrapper,
    );
    this.emitter.on(
      eventName, wrapper,
    );
  }

  off<TEventName extends keyof WithHeightAndUUID<EventMap> & string>(
    eventName: TEventName,
    handler: (eventArg: WithHeightAndUUID<EventMap>[TEventName]) => void,
  ) {
    const count = this.handled.get(eventName);
    if (count && count > 1) {
      this.handled.set(
        eventName, count - 1,
      );
    }
    else {
      this.handled.delete(eventName);
    }
    const wrapper = this.handlerMap.get(handler);
    if (wrapper) {
      this.emitter.off(
        eventName, wrapper,
      );
      this.handlerMap.delete(handler);
    }
  }
}
