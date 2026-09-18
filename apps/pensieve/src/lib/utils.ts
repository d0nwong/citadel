import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/** "2026-08-28" → "Thu 28 Aug 2026" — the reading-room date. */
export function prettyDay(
  day: string,
  opts: { weekday?: boolean } = { weekday: true }
) {
  const d = new Date(`${day}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    return day;
  }
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    weekday: opts.weekday ? "short" : undefined,
    year: "numeric",
  });
}

/** "2026-09-06T09:14:03.000Z" → "6 Sep 2026, 09:14" — a list-row timestamp. */
export function prettyStamp(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString("en-GB", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** "3m ago", "in 12m", "2h ago" — how far `iso` is from `now`, to the minute. */
export function relativeTime(iso: string, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    return iso;
  }
  const diff = t - now;
  const mins = Math.round(Math.abs(diff) / 60_000);
  let span: string;
  if (mins < 1) {
    return diff < 0 ? "just now" : "any moment";
  }
  if (mins < 60) {
    span = `${mins}m`;
  } else if (mins < 48 * 60) {
    span = `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
  } else {
    span = `${Math.floor(mins / 1440)}d`;
  }
  return diff < 0 ? `${span} ago` : `in ${span}`;
}

export function daysSince(day?: string): number | null {
  if (!day) {
    return null;
  }
  const d = new Date(`${day}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

/**
 * The Linear workspace an issue url is built under, for the keys a ledger records without one
 * (`linear.app/<workspace>/issue/<KEY>`). Read in the browser, so it is baked at build time:
 * changing it means rebuilding the image, not restarting it.
 */
export const LINEAR_ISSUE = `https://linear.app/${
  import.meta.env.VITE_LINEAR_WORKSPACE || "liamai"
}/issue/`;
