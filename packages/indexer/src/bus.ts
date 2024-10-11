import { v4 as uuidv4 } from "uuid";

//import { Events as ModuleEvents } from "./modules";
import { UUIDEvent } from "./types";
import { Emitter } from "./utils/emitter";

export type WithHeightAndUUID<T> = {
  [K in keyof T]: T[K] & { uuid?: string; height?: number; timestamp?: string };
};
type EmitFunc<K extends keyof WithHeightAndUUID<EventMap>> = (
  t: K,
  e: WithHeightAndUUID<EventMap>[K]
) => Promise<void | void[]>;

const bus = new Emitter<WithHeightAndUUID<EventMap>>();

bus.on("_unhandled", (msg) => {
  if (msg.uuid) {
    log.verbose("Unhandled event: " + msg.type);
    bus.emit("uuid", { status: true, uuid: msg.uuid });
  }
});
const log = {
  log: (message: string) => {
    bus.emit("log", { type: "log", message });
  },
  info: (message: string) => {
    bus.emit("log", { type: "info", message });
  },
  warning: (message: string) => {
    bus.emit("log", { type: "warning", message });
  },
  error: (message: string) => {
    bus.emit("log", { type: "error", message });
  },
  verbose: (message: string) => {
    bus.emit("log", { type: "verbose", message });
  },
  transient: (message: string) => {
    bus.emit("log", { type: "transient", message });
  },
};

const asyncEmit: EmitFunc<keyof WithHeightAndUUID<EventMap>> = async (
  type,
  event
) => {
  event.uuid = uuidv4();

  // More than 1 listener can be registered for an event type
  // Fortunately these are all set up during module init() so we have a consistent count
  // so we can count responses to resolve when complete
  // values are irrelevant as promise resolution is only used for flow control
  let listenerCount = bus.handled.get(type);
  if (!listenerCount) {
    // Setting listenerCount to 1 (the unhandled listener)
    listenerCount = 1;
  }
  let listenersResponded = 0;
  const prom = new Promise<void>((resolve, reject) => {
    const returnFunc = (ev: UUIDEvent) => {
      if (ev.uuid == event.uuid) {
        if (ev.status) {
          listenersResponded++;
          if (listenersResponded == listenerCount) {
            // All listeners have done their thing so we can remove listener, resolve and continue execution
            bus.off("uuid", returnFunc);
            resolve();
          }
        } else {
          // At least 1 listener is reporting an error. Reject and handle exception at the original asyncEmit location
          reject();
        }
      }
    };
    bus.on("uuid", returnFunc);
  });
  bus.emit(type, event);

  return prom;
};
export { asyncEmit, bus, log };
