/** The open flow is the URL's hash, `#/<id>`: no router, and a link to a flow is just its hash. */

import { useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

export const flowIdOf = (hash: string) => hash.replace(/^#\/?/, "");

export function useFlowId(): string {
  return flowIdOf(useSyncExternalStore(subscribe, () => window.location.hash));
}
