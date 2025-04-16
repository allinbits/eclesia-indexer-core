import EventEmitter from "events";

import { WithHeightAndUUID } from "../types";

export class EclesiaEmitter {
  private emitter = new EventEmitter();

  public handled = new Map<string, number>();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  emit<EType extends keyof (WithHeightAndUUID<EventMap>) & string>(
    eventName: EType,
    eventArg: WithHeightAndUUID<EventMap>[EType] & { uuid?: string }) {
    if (this.handled.has(eventName)) {
      this.emitter.emit(eventName, eventArg);
    } else {
      this.emitter.emit("_unhandled", {
        type: eventName as string,
        event: eventArg,
        uuid: eventArg.uuid
      });
    }
  }

  on<TEventName extends keyof WithHeightAndUUID<EventMap> & string | "_unhandled">(eventName: TEventName,
    handler: TEventName extends "_unhandled"
      ? (eventArg: { type: string;
        event: unknown;
        uuid: string; }) => void
      : (eventArg: TEventName extends keyof WithHeightAndUUID<EventMap> ? WithHeightAndUUID<EventMap>[TEventName] : never) => void) {
    const count = this.handled.get(eventName);
    if (count) {
      this.handled.set(eventName, count + 1);
    } else {
      this.handled.set(eventName, 1);
    }
    this.emitter.on(eventName, async(eventData) => {
      try {
        await handler(eventData);
        if (eventName !== "uuid" && eventName !== "_unhandled" && eventData.uuid) {
          this.emit("uuid", { status: true,
            uuid: eventData.uuid });
        }
      } catch (error) {    
        if (eventName !== "uuid" && eventName !== "_unhandled" && eventData.uuid) {    
          this.emit("uuid", { status: false,
            error: error as string,
            uuid: eventData.uuid });        
        }
      }
    });
  }

  off<TEventName extends keyof WithHeightAndUUID<EventMap> & string>(eventName: TEventName,
    handler: (eventArg: WithHeightAndUUID<EventMap>[TEventName]) => void) {
    const count = this.handled.get(eventName);
    if (count && count > 1) {
      this.handled.set(eventName, count - 1);
    } else {
      this.handled.delete(eventName);
    }
    this.emitter.off(eventName, handler);
  }
}
