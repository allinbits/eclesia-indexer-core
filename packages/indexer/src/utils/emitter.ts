import EventEmitter from "events";

export class Emitter<Events> {
  private emitter = new EventEmitter();

  public handled = new Map<string, number>();

  constructor () {
    this.emitter.setMaxListeners(0);
  }

  emit<EType extends keyof Events & string>(
    eventName: EType,
    eventArg: Events[EType] & { uuid?: string }
  ) {
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

  on<TEventName extends keyof Events & string  | "_unhandled">(
    eventName: TEventName,
    handler: TEventName extends "_unhandled"
      ? (eventArg: { type: string;
        event: unknown; }) => void
      : (eventArg: TEventName extends keyof Events ? Events[TEventName] : never) => void
  ) {
    const count = this.handled.get(eventName);
    if (count) {
      this.handled.set(eventName, count + 1);
    } else {
      this.handled.set(eventName, 1);
    }
    this.emitter.on(eventName, handler);
  }

  off<TEventName extends keyof Events & string>(
    eventName: TEventName,
    handler: (eventArg: Events[TEventName]) => void
  ) {
    const count = this.handled.get(eventName);
    if (count && count > 1) {
      this.handled.set(eventName, count - 1);
    } else {
      this.handled.delete(eventName);
    }
    this.emitter.off(eventName, handler);
  }
}
