/** Every flow, in tab order. A new flow is a file beside this one, added here. */

import type { Flow } from "../model.ts";
import { foundry } from "./foundry.ts";
import { scope } from "./scope.ts";
import { sweep } from "./sweep.ts";

export const FLOWS: Flow[] = [scope, foundry, sweep];
