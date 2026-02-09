/**
 * BERLIN PROVIDER ADAPTERS
 */

export { bvgAdapter, BVGAdapter } from "./bvg";
export { boltBerlinAdapter, BoltBerlinAdapter } from "./bolt";
export { limeBerlinAdapter, LimeBerlinAdapter } from "./lime";

import { bvgAdapter } from "./bvg";
import { boltBerlinAdapter } from "./bolt";
import { limeBerlinAdapter } from "./lime";
import type { ProviderAdapter } from "../../types";

export const berlinProviders: ProviderAdapter[] = [
  bvgAdapter,
  boltBerlinAdapter,
  limeBerlinAdapter,
];
