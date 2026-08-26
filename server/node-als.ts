import { AsyncLocalStorage } from "node:async_hooks";

const g = globalThis as typeof globalThis & { AsyncLocalStorage?: typeof AsyncLocalStorage };
if (typeof g.AsyncLocalStorage !== "function") {
  g.AsyncLocalStorage = AsyncLocalStorage;
}
