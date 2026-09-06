/**
 * Pure helpers behind the Tool blocks on /ask/$id (LIA-103). The harness's built-in tools
 * (`Read`, `Grep`, `Glob`, `Bash …`) arrive as tool-call parts whose `arguments` is the
 * SDK's JSON; the collapsed header needs one line saying what the call was about, and a
 * tool result's content may be a string or a list of content parts.
 */
type Rec = Record<string, unknown>

const rec = (v: unknown): Rec | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/**
 * What the call is about: the path for `Read`, the pattern (and where) for `Grep` and
 * `Glob`, the command for `Bash`, the first string argument for anything else. Empty when
 * there is nothing to say — the caller falls back to the bare tool name.
 */
export function toolSummary(name: string, input: unknown): string {
  const r = rec(input)
  if (!r) return ''
  const where = str(r.path)
  const inPath = (main?: string) => (main ? (where ? `${main} in ${where}` : main) : '')
  switch (name) {
    case 'Read':
      return str(r.file_path) ?? where ?? ''
    case 'Grep':
    case 'Glob':
      return inPath(str(r.pattern))
    case 'Bash':
      return str(r.command) ?? ''
    default: {
      const first = Object.values(r).find((v) => typeof v === 'string' && v.trim())
      return typeof first === 'string' ? first.trim() : ''
    }
  }
}

/** `ToolCallPart.arguments` is JSON, possibly cut off mid-stream; `undefined` until it parses. */
export function parseArguments(args: string | undefined): unknown {
  if (!args) return undefined
  try {
    return JSON.parse(args)
  } catch {
    return undefined
  }
}

/**
 * A tool result's text. `ToolResultPart.content` is a string or an array of content parts;
 * only the text parts count, joined in order (the same rule as TanStack's internal
 * `toolResultContentToString`, which the `/ui` barrel does not export).
 */
export function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((p) => {
      const part = rec(p)
      return part && part.type === 'text' && typeof part.content === 'string' ? part.content : ''
    })
    .join('')
}
