/**
 * /reports — the sweep-log page, retired. It read `reports/points.json` and the day's
 * report, and the sweep stopped writing both when the board replaced them (LIA-161); a page
 * over a file nobody writes goes stale the day it lands, so it goes and the archive stands
 * in its place (LIA-162 AC1). Every `reports/<day>.md` already committed still renders at
 * `/reports/$day`, which is what the archive links to.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/reports/")({
  beforeLoad: () => {
    throw redirect({ to: "/archive" });
  },
});
