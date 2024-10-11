import { Events } from "./types";

declare global {
  export interface EventMap extends Events {}
}
