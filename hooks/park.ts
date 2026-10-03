export const STATE_FILE = '.local/state/cc-mod-park/parked.json'
export const HERDR_TITLE_FILE = '.local/state/herdr-session-title/state.json'
export const RECAP_DIR = '.cache/cc-recap'
export const PROMPT_TITLE_CHARS = 40

export type Entry = {
  id: string
  dir: string
  // Main repo root, so a worktree parked and later removed still shows under the repo
  repoRoot: string | null
  branch: string | null
  title: string
  goal: string | null
  now: string | null
  next: string | null
  parkedAt: number
}

export type Shown = Entry & { dirGone: boolean }

const str = (value: unknown) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : null)

export const parseList = (text: string | null): Entry[] => {
  if (text === null) return []
  try {
    const raw: unknown = JSON.parse(text)
    if (!Array.isArray(raw)) return []
    return raw.flatMap((item): Entry[] => {
      const id = str(item?.id)
      const dir = str(item?.dir)
      const title = str(item?.title)
      if (id === null || dir === null || title === null || typeof item.parkedAt !== 'number') return []
      return [{ id, dir, repoRoot: str(item.repoRoot), branch: str(item.branch), title, goal: str(item.goal), now: str(item.now), next: str(item.next), parkedAt: item.parkedAt }]
    })
  } catch {
    return []
  }
}

export const serialize = (list: readonly Entry[]) => `${JSON.stringify(list, null, 2)}\n`

export const upsert = (list: readonly Entry[], entry: Entry): Entry[] => [...list.filter((one) => one.id !== entry.id), entry]

export const without = (list: readonly Entry[], id: string): Entry[] => list.filter((one) => one.id !== id)

const parentOf = (path: string) => {
  const cut = path.replace(/\/+$/, '').lastIndexOf('/')
  return cut <= 0 ? '/' : path.slice(0, cut)
}

// A gone directory falls back to its repo root, else to its nearest surviving ancestor,
// so it shows in one predictable place instead of nowhere.
export const homeDir = (entry: Entry, exists: (path: string) => boolean): { dir: string; dirGone: boolean } => {
  if (exists(entry.dir)) return { dir: entry.dir, dirGone: false }
  if (entry.repoRoot !== null && exists(entry.repoRoot)) return { dir: entry.repoRoot, dirGone: true }
  let dir = parentOf(entry.dir)
  while (dir !== '/' && !exists(dir)) dir = parentOf(dir)
  return { dir, dirGone: true }
}

export const shownFor = (list: readonly Entry[], cwd: string, exists: (path: string) => boolean): Shown[] =>
  list
    .flatMap((entry) => {
      const home = homeDir(entry, exists)
      return home.dir === cwd ? [{ ...entry, dirGone: home.dirGone }] : []
    })
    .sort((a, b) => b.parkedAt - a.parkedAt)

const clip = (text: string, chars: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  const units = [...flat]
  return units.length > chars ? `${units.slice(0, chars).join('')}…` : flat
}

export type TitleSources = { note: string | null; herdrTitle: string | null; aiTitle: string | null; firstPrompt: string | null }

export const pickTitle = (sources: TitleSources): string => {
  const prompt = str(sources.firstPrompt)
  return str(sources.note) ?? str(sources.herdrTitle) ?? str(sources.aiTitle) ?? (prompt === null ? null : clip(prompt, PROMPT_TITLE_CHARS)) ?? '（未命名 session）'
}

export const herdrTitleOf = (stateText: string | null, id: string): string | null => {
  if (stateText === null) return null
  try {
    return str(JSON.parse(stateText)?.[id]?.name)
  } catch {
    return null
  }
}

export const recapOf = (text: string | null): { goal: string | null; now: string | null; next: string | null } => {
  if (text === null) return { goal: null, now: null, next: null }
  try {
    const raw = JSON.parse(text)
    return { goal: str(raw?.goal), now: str(raw?.now), next: str(raw?.next) }
  } catch {
    return { goal: null, now: null, next: null }
  }
}

// Last ai-title wins: Claude Code appends a new one each time it retitles
export const aiTitleOf = (transcript: string | null): string | null => {
  if (transcript === null) return null
  let title: string | null = null
  for (const line of transcript.split('\n')) {
    if (!line.includes('"ai-title"')) continue
    try {
      const row = JSON.parse(line)
      if (row?.type === 'ai-title') title = str(row.aiTitle) ?? title
    } catch {}
  }
  return title
}

// Claude Code names a project folder after its directory with every non-alphanumeric character as '-'
export const projectFolder = (dir: string) => dir.replace(/[^a-zA-Z0-9]/g, '-')

// Tool results and injected tags also arrive as user messages; a real prompt is plain text
export const firstPromptOf = (messages: readonly { role: string; text: string }[]): string | null =>
  messages.find((m) => m.role === 'user' && m.text.trim().length > 0 && !m.text.trimStart().startsWith('<'))?.text ?? null

export const ageText = (parkedAt: number, now: number) => {
  const minutes = Math.max(0, Math.floor((now - parkedAt) / 60_000))
  if (minutes < 60) return `${minutes} 分鐘前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小時前`
  return `${Math.floor(hours / 24)} 天前`
}

export const isNewWork = (text: string) => text.trim().length > 0 && !text.trimStart().startsWith('/')
