/** Every flow, in tab order. A new flow is a file beside this one, added here. */

import type { Flow } from "../model.ts";
import { scope } from "./scope.ts";

export const FLOWS: Flow[] = [scope];
