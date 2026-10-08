import type { Strings } from './i18n.ts'

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
  // Null on entries parked before 0.2.0, or before the session sent any request (no effort seen yet)
  model: string | null
  effort: string | null
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
      return [{ id, dir, repoRoot: str(item.repoRoot), branch: str(item.branch), title, goal: str(item.goal), now: str(item.now), next: str(item.next), model: str(item.model), effort: str(item.effort), parkedAt: item.parkedAt }]
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

export const pickTitle = (sources: TitleSources, ui: Strings): string => {
  const prompt = str(sources.firstPrompt)
  return str(sources.note) ?? str(sources.herdrTitle) ?? str(sources.aiTitle) ?? (prompt === null ? null : clip(prompt, PROMPT_TITLE_CHARS)) ?? ui.untitled
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

export const ageText = (parkedAt: number, now: number, ui: Strings): string => {
  const minutes = Math.max(0, Math.floor((now - parkedAt) / 60_000))
  if (minutes < 60) return ui.minutesAgo(minutes)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return ui.hoursAgo(hours)
  return ui.daysAgo(Math.floor(hours / 24))
}

export const modelLine = (model: string | null, effort: string | null, ui: Strings): string | null =>
  model === null && effort === null ? null : [model ?? ui.modelNotRecorded, effort ?? ui.effortNotRecorded].join(' · ')

// One line per setting so a mismatch is visible at a glance after resume
export const restoreReport = (wanted: { model: string | null; effort: string | null }, actual: { model: string | null; effortError: string | null }, ui: Strings): string[] => [
  wanted.model === null ? ui.modelNotRestored : ui.modelCheck(wanted.model, actual.model, actual.model === wanted.model),
  // /effort run from a plugin returns no text, so the first request after resume is where effort is confirmed
  wanted.effort === null
    ? ui.effortNotRestored
    : actual.effortError !== null
      ? ui.effortFailed(wanted.effort, actual.effortError)
      : ui.effortSet(wanted.effort),
]

// The two settings a resume can overwrite: /resume saves the session's model as the default model,
// and /effort saves the level as that model's default
export type Defaults = { model: string | null; effort: string | null }

type Json = Record<string, unknown>
const asObject = (value: unknown): Json => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {})

export const defaultsOf = (settings: unknown, model: string | null): Defaults => {
  const root = asObject(settings)
  const perModel = model === null ? {} : asObject(asObject(root.modelSettings)[model])
  return { model: str(root.model), effort: str(perModel.effortLevel) }
}

// Puts back exactly what was there: a key absent before the resume is removed, not set to null
export const withDefaults = (settings: unknown, model: string | null, wanted: Defaults): Json => {
  const original = asObject(settings)
  const { model: _dropped, ...withoutModel } = original
  const root: Json = wanted.model === null ? withoutModel : { ...original, model: wanted.model }
  if (model === null) return root
  const all = asObject(root.modelSettings)
  const { effortLevel: _droppedEffort, ...otherFields } = asObject(all[model])
  const entry: Json = wanted.effort === null ? otherFields : { ...asObject(all[model]), effortLevel: wanted.effort }
  const { [model]: _droppedEntry, ...otherModels } = all
  if (Object.keys(entry).length > 0) return { ...root, modelSettings: { ...all, [model]: entry } }
  // Left empty, modelSettings was most likely created by /effort during the resume; an empty one written by hand goes too, which changes no setting
  if (Object.keys(otherModels).length > 0) return { ...root, modelSettings: otherModels }
  const { modelSettings: _droppedAll, ...withoutModelSettings } = root
  return withoutModelSettings
}

export const sameDefaults = (a: Defaults, b: Defaults) => a.model === b.model && a.effort === b.effort

// A failed read must not look like an empty file: writing back over "nothing" would wipe every other setting
export type SettingsRead = { kind: 'ok'; value: unknown } | { kind: 'missing' } | { kind: 'unreadable' }

const isObject = (value: unknown) => typeof value === 'object' && value !== null && !Array.isArray(value)

// Null means unknown, so nothing after the resume can be judged against it
export const defaultsBefore = (read: SettingsRead, model: string | null): Defaults | null => {
  if (read.kind === 'missing') return { model: null, effort: null }
  if (read.kind === 'unreadable' || !isObject(read.value)) return null
  return defaultsOf(read.value, model)
}

export const writeBackPlan = (before: Defaults | null, now: SettingsRead, model: string | null, ui: Strings): { write: null; line: string } | { write: Json; line: null } => {
  if (before === null) return { write: null, line: ui.defaultsUnknownBefore }
  if (now.kind !== 'ok' || !isObject(now.value)) return { write: null, line: ui.defaultsUnreadable }
  if (sameDefaults(before, defaultsOf(now.value, model))) return { write: null, line: ui.defaultsUnchanged }
  return { write: withDefaults(now.value, model, before), line: null }
}

export const isNewWork = (text: string) => text.trim().length > 0 && !text.trimStart().startsWith('/')
