/**
 * /arcs — retired. An arc was the running story of one initiative, and a workstream is the
 * better answer to the same question, so the sweep stopped writing `arcs/` (LIA-161) and
 * the pages over it go with it (LIA-162 AC1). What is already committed under `arcs/` stays
 * as history; the state of an initiative is its workstream's page.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/arcs/")({
  beforeLoad: () => {
    throw redirect({ to: "/archive" });
  },
});
