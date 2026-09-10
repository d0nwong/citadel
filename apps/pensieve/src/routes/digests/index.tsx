/**
 * /digests — the digest index, retired with the digest itself (LIA-161): the sweep no
 * longer writes `digests/<day>.md`, so there is nothing for this page to be an index of
 * beyond what is already committed, which the archive lists (LIA-162 AC1). Every digest on
 * disk still renders at `/digests/$day`.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/digests/")({
  beforeLoad: () => {
    throw redirect({ to: "/archive" });
  },
});
