/** One arc's page, retired with the arcs — see `./index.tsx` (LIA-162 AC1). */

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/arcs/$slug")({
  beforeLoad: () => {
    throw redirect({ to: "/archive" });
  },
});
