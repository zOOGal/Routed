/**
 * TOKYO PROVIDER ADAPTERS
 */

export { suicaAdapter, SuicaAdapter } from "./suica";
export { goTaxiAdapter, GoTaxiAdapter } from "./go-taxi";
export { docomoBikeAdapter, DocomoBikeAdapter } from "./docomo-bike";

import { suicaAdapter } from "./suica";
import { goTaxiAdapter } from "./go-taxi";
import { docomoBikeAdapter } from "./docomo-bike";
import type { ProviderAdapter } from "../../types";

export const tokyoProviders: ProviderAdapter[] = [
  suicaAdapter,
  goTaxiAdapter,
  docomoBikeAdapter,
];
