/**
 * NYC PROVIDER ADAPTERS
 */

export { mtaAdapter, MTAAdapter } from "./mta";
export { uberNYCAdapter, UberNYCAdapter } from "./uber";
export { citiBikeAdapter, CitiBikeAdapter } from "./citibike";

import { mtaAdapter } from "./mta";
import { uberNYCAdapter } from "./uber";
import { citiBikeAdapter } from "./citibike";
import type { ProviderAdapter } from "../../types";

export const nycProviders: ProviderAdapter[] = [
  mtaAdapter,
  uberNYCAdapter,
  citiBikeAdapter,
];
