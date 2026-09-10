/**
 * The small parts every ledger page shares: a status chip whose tone is the status, the
 * evidence line under a sentence, and the feature's directory as a link. Statuses map
 * onto the shell's five tones so the ledger reads in the same colours as the rest of the
 * app: assumed and asked are amber (waiting), built is blue, confirmed and closed are
 * green, contradicted is red, retired and dropped are grey.
 */

import { Link } from "@tanstack/react-router";
import { Tag, type Tone } from "#/components/bits";
import {
  type AskStatus,
  type Evidence,
  evidenceHref,
  evidenceLabel,
  type RequirementStatus,
} from "#/lib/ledger";

const TONE: Record<RequirementStatus | AskStatus, Tone> = {
  acknowledged: "documented",
  answered: "decided",
  asked: "decided",
  assumed: "decided",
  built: "implemented",
  closed: "documented",
  confirmed: "documented",
  contradicted: "hold",
  dropped: "superseded",
  retired: "superseded",
};

export function Status({ status }: { status: RequirementStatus | AskStatus }) {
  return <Tag tone={TONE[status]}>{status}</Tag>;
}

/** Links to what a sentence points at, muted, under it. */
export function EvidenceLine({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) {
    return null;
  }
  return (
    <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
      {evidence.map((e, i) => {
        const href = evidenceHref(e);
        const label = evidenceLabel(e);
        const key = `${e.kind}-${i}`;
        return (
          <span key={key}>
            {i > 0 && <span className="mx-1.5">·</span>}
            {href ? (
              <a
                className="underline decoration-1 underline-offset-2 hover:text-foreground"
                href={href}
                rel="noreferrer"
                target="_blank"
                title={e.kind === "slack" ? e.quote : undefined}
              >
                {label}
              </a>
            ) : (
              <span
                className={
                  e.kind === "assumption" || e.kind === "user"
                    ? "text-st-decided"
                    : "mono"
                }
              >
                {label}
              </span>
            )}
          </span>
        );
      })}
    </p>
  );
}

export function FeatureName({
  feature,
  dir,
}: {
  feature: string;
  dir: string;
}) {
  return (
    <Link
      className="font-medium text-foreground underline decoration-1 decoration-border underline-offset-2 hover:decoration-foreground"
      params={{ _splat: feature }}
      to="/features/$"
    >
      {dir}
    </Link>
  );
}
