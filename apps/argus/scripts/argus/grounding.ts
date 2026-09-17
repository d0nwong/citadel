/**
 * Whether a proposal's Technical Notes point at code. The reader cannot read the product
 * code, so it writes a proposal without Technical Notes; the sweep's grounding step, which
 * can, writes them (`skills/sweep/ground.md`). A note is grounded when it names a repo path
 * in backticks (`src/hooks/projects/use-create-project.ts`), or is an open question.
 */

const SECTION = /^##\s+Technical Notes\s*$/im;
const PATH = /`[^`\n]*(?:\/|\.(?:tsx?|jsx?|mjs|json|md|sql|ya?ml|css|prisma|sh))[^`\n]*`/;
const QUESTION = /^(?:open question|confirm)\b/i;

/** the Technical Notes bullets, continuation lines joined; null when the body has no such section */
export function technicalNotes(body: string): string[] | null {
  const m = SECTION.exec(body);
  if (!m) return null;
  const rest = body.slice(m.index + m[0].length);
  const end = rest.search(/^##\s/m);
  const out: string[] = [];
  for (const line of (end < 0 ? rest : rest.slice(0, end)).split("\n")) {
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) out.push(bullet[1]!);
    else if (/^\s+\S/.test(line) && out.length) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out;
}

/** the notes that name no file and are not an open question */
export function ungroundedNotes(body: string): string[] {
  return (technicalNotes(body) ?? []).filter((n) => !PATH.test(n) && !QUESTION.test(n));
}

/** true when the body has Technical Notes and every one of them is grounded */
export function isGrounded(body: string): boolean {
  const notes = technicalNotes(body);
  return !!notes && notes.length > 0 && ungroundedNotes(body).length === 0;
}
