import {
  Events,
} from "./types";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface EventMap extends Events {
  }
}
