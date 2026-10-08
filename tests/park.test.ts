import { describe, expect, test } from 'bun:test'
import { pickLocale, stringsFor } from '../hooks/i18n.ts'
import { aiTitleOf, ageText, defaultsBefore, defaultsOf, firstPromptOf, herdrTitleOf, isNewWork, modelLine, parseList, pickTitle, projectFolder, recapOf, restoreReport, sameDefaults, serialize, shownFor, upsert, withDefaults, without, writeBackPlan, type Entry } from '../hooks/park.ts'

const entry = (over: Partial<Entry>): Entry => ({ id: 's1', dir: '/w/repo', repoRoot: '/w/repo', branch: 'main', title: 't', goal: null, now: null, next: null, model: null, effort: null, parkedAt: 0, ...over })
const existsIn = (paths: string[]) => (path: string) => paths.includes(path)
const zh = stringsFor('zh-TW')
const en = stringsFor('en')

describe('list file', () => {
  test('round-trips and drops malformed rows', () => {
    const list = [entry({ id: 'a' })]
    expect(parseList(serialize(list))).toEqual(list)
    expect(parseList('[{"id":"x"},null,' + JSON.stringify(entry({ id: 'b' })) + ']').map((e) => e.id)).toEqual(['b'])
    expect(parseList('not json')).toEqual([])
    expect(parseList(null)).toEqual([])
  })

  test('an entry parked before model/effort were recorded still loads, with both null', () => {
    const legacy = { id: 'old', dir: '/w/repo', repoRoot: null, branch: null, title: 't', goal: null, now: null, next: null, parkedAt: 1 }
    expect(parseList(JSON.stringify([legacy]))[0]).toMatchObject({ id: 'old', model: null, effort: null })
    expect(parseList(serialize([entry({ model: 'claude-opus-5-5', effort: 'high' })]))[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'high' })
  })

  test('parking the same session again replaces its entry', () => {
    const list = upsert([entry({ id: 'a', title: 'old' }), entry({ id: 'b' })], entry({ id: 'a', title: 'new' }))
    expect(list.map((e) => [e.id, e.title])).toEqual([['b', 't'], ['a', 'new']])
    expect(without(list, 'a').map((e) => e.id)).toEqual(['b'])
  })
})

describe('shownFor', () => {
  test('only sessions parked in this exact folder show, newest first', () => {
    const list = [entry({ id: 'here-old', parkedAt: 1 }), entry({ id: 'child', dir: '/w/repo/sub' }), entry({ id: 'other', dir: '/w/other', repoRoot: null }), entry({ id: 'here-new', parkedAt: 2 })]
    const shown = shownFor(list, '/w/repo', existsIn(['/w/repo', '/w/repo/sub', '/w/other']))
    expect(shown.map((e) => e.id)).toEqual(['here-new', 'here-old'])
  })

  test('a removed worktree shows under its repo root, flagged', () => {
    const list = [entry({ id: 'wt', dir: '/w/repo/.claude/worktrees/x', repoRoot: '/w/repo' })]
    expect(shownFor(list, '/w/repo', existsIn(['/w/repo', '/w/repo/.claude', '/w/repo/.claude/worktrees']))).toEqual([{ ...list[0]!, dirGone: true }])
    expect(shownFor(list, '/w/repo/.claude/worktrees/x', existsIn(['/w/repo/.claude/worktrees/x', '/w/repo']))[0]?.dirGone).toBe(false)
  })

  test('a removed folder with no repo shows under its nearest surviving parent', () => {
    const list = [entry({ id: 'gone', dir: '/w/scratch/a/b', repoRoot: null })]
    expect(shownFor(list, '/w/scratch', existsIn(['/w', '/w/scratch'])).map((e) => e.id)).toEqual(['gone'])
    expect(shownFor(list, '/w', existsIn(['/w', '/w/scratch']))).toEqual([])
  })
})

describe('title', () => {
  test('note, then herdr title, then Claude Code title, then the first prompt clipped to 40', () => {
    const base = { note: null, herdrTitle: null, aiTitle: null, firstPrompt: null }
    expect(pickTitle({ ...base, note: ' 週一接 ', herdrTitle: 'H' }, zh)).toBe('週一接')
    expect(pickTitle({ ...base, note: '', herdrTitle: 'H', aiTitle: 'A' }, zh)).toBe('H')
    expect(pickTitle({ ...base, aiTitle: 'A', firstPrompt: 'P' }, zh)).toBe('A')
    expect(pickTitle({ ...base, firstPrompt: '一'.repeat(45) }, zh)).toBe(`${'一'.repeat(40)}…`)
    expect(pickTitle(base, zh)).toBe('（未命名 session）')
  })

  test('herdr title and recap read tolerantly', () => {
    expect(herdrTitleOf(JSON.stringify({ s1: { name: 'Checkout Redesign' }, s2: { name: '' } }), 's1')).toBe('Checkout Redesign')
    expect(herdrTitleOf(JSON.stringify({ s2: { name: '' } }), 's2')).toBeNull()
    expect(herdrTitleOf('{', 's1')).toBeNull()
    expect(recapOf(JSON.stringify({ goal: 'g', now: 'n', next: '' }))).toEqual({ goal: 'g', now: 'n', next: null })
    expect(recapOf(null)).toEqual({ goal: null, now: null, next: null })
  })

  test('the last ai-title in the transcript wins', () => {
    const rows = [{ type: 'user' }, { type: 'ai-title', aiTitle: '舊' }, { type: 'ai-title', aiTitle: '新' }].map((r) => JSON.stringify(r)).join('\n')
    expect(aiTitleOf(rows)).toBe('新')
    expect(aiTitleOf('{"type":"user"}')).toBeNull()
  })

  test('first prompt skips tool results and injected tags', () => {
    expect(firstPromptOf([{ role: 'assistant', text: 'hi' }, { role: 'user', text: '' }, { role: 'user', text: '<command-name>/x</command-name>' }, { role: 'user', text: '做個 park' }])).toBe('做個 park')
  })

  test('project folder matches Claude Code naming', () => {
    expect(projectFolder('/private/tmp/claude-501/-Users-x/scratchpad/probe-dir')).toBe('-private-tmp-claude-501--Users-x-scratchpad-probe-dir')
  })
})

test('age reads in minutes, hours, then days', () => {
  expect(ageText(0, 59 * 60_000, zh)).toBe('59 分鐘前')
  expect(ageText(0, 3 * 3_600_000, zh)).toBe('3 小時前')
  expect(ageText(0, 2.5 * 86_400_000, zh)).toBe('2 天前')
})

test('model line shows what was recorded and marks what was not', () => {
  expect(modelLine('claude-opus-5-5', 'high', zh)).toBe('claude-opus-5-5 · high')
  expect(modelLine('claude-opus-5-5', null, zh)).toBe('claude-opus-5-5 · （effort 未記錄）')
  expect(modelLine(null, null, zh)).toBeNull()
})

test('restore report marks a model mismatch and defers effort to the first request', () => {
  expect(restoreReport({ model: 'claude-opus-5-5', effort: 'high' }, { model: 'claude-opus-5-5', effortError: null }, zh)).toEqual([
    'model：要 claude-opus-5-5，現在 claude-opus-5-5 ✓',
    'effort：已用 /effort 設為 high，送出下一則訊息時確認',
  ])
  expect(restoreReport({ model: 'claude-opus-5-5', effort: null }, { model: 'claude-sonnet-5-5', effortError: null }, zh)).toEqual([
    'model：要 claude-opus-5-5，現在 claude-sonnet-5-5 ✗',
    'effort：停泊時沒記錄，未還原',
  ])
})

test('a failed /effort is reported as failed, not as set', () => {
  expect(restoreReport({ model: null, effort: 'high' }, { model: 'claude-opus-5-5', effortError: 'Error: boom' }, zh)[1]).toBe('effort：/effort high 失敗（Error: boom），未還原 ✗')
})

describe('defaults write-back', () => {
  const settings = { model: 'opus', effortLevel: 'xhigh', modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' }, 'claude-sonnet-5-5': { effortLevel: 'medium' } }, tui: 'default' }

  test('reads the default model and the given model\'s default effort', () => {
    expect(defaultsOf(settings, 'claude-sonnet-5-5')).toEqual({ model: 'opus', effort: 'medium' })
    expect(defaultsOf(settings, 'claude-fable-5-1')).toEqual({ model: 'opus', effort: null })
    expect(defaultsOf(null, null)).toEqual({ model: null, effort: null })
  })

  test('puts back what a resume overwrote and keeps every other key and its order', () => {
    const touched = { ...settings, model: 'claude-sonnet-5-5', modelSettings: { ...settings.modelSettings, 'claude-sonnet-5-5': { effortLevel: 'low' } } }
    const fixed = withDefaults(touched, 'claude-sonnet-5-5', { model: 'opus', effort: 'medium' })
    expect(JSON.stringify(fixed)).toBe(JSON.stringify(settings))
  })

  test('a key absent before the resume is removed rather than set to null', () => {
    const touched = { model: 'claude-sonnet-5-5', modelSettings: { 'claude-sonnet-5-5': { effortLevel: 'low' } } }
    expect(withDefaults(touched, 'claude-sonnet-5-5', { model: null, effort: null })).toEqual({})
  })

  test('keeps other models when the resumed model entry empties', () => {
    const touched = { modelSettings: { 'claude-sonnet-5-5': { effortLevel: 'low' }, 'claude-opus-5-5': { effortLevel: 'high' } } }
    expect(withDefaults(touched, 'claude-sonnet-5-5', { model: null, effort: null })).toEqual({ modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } } })
  })

  test('writes back only over a settings file it could read as an object', () => {
    const before = { model: 'opus', effort: 'medium' }
    const touched = { ...settings, model: 'claude-sonnet-5-5' }
    expect(writeBackPlan(before, { kind: 'ok', value: touched }, 'claude-sonnet-5-5', zh).write).toEqual(withDefaults(touched, 'claude-sonnet-5-5', before))
    for (const now of [{ kind: 'missing' }, { kind: 'unreadable' }, { kind: 'ok', value: null }, { kind: 'ok', value: [] }] as const) {
      expect(writeBackPlan(before, now, 'claude-sonnet-5-5', zh)).toEqual({ write: null, line: '預設設定：讀不到 settings.json，沒有改回；請自己確認 /model 與 /effort 的預設' })
    }
  })

  test('does not write when the defaults before the resume are unknown or unchanged', () => {
    expect(writeBackPlan(null, { kind: 'ok', value: settings }, 'claude-sonnet-5-5', zh)).toEqual({ write: null, line: '預設設定：接回前讀不到 settings.json，沒有檢查是否被改動' })
    expect(writeBackPlan({ model: 'opus', effort: 'medium' }, { kind: 'ok', value: settings }, 'claude-sonnet-5-5', zh)).toEqual({ write: null, line: '預設設定：沒被改動' })
  })

  test('defaults before a resume: a missing file means none set, an unreadable one means unknown', () => {
    expect(defaultsBefore({ kind: 'ok', value: settings }, 'claude-sonnet-5-5')).toEqual({ model: 'opus', effort: 'medium' })
    expect(defaultsBefore({ kind: 'missing' }, 'claude-sonnet-5-5')).toEqual({ model: null, effort: null })
    expect(defaultsBefore({ kind: 'unreadable' }, 'claude-sonnet-5-5')).toBeNull()
    expect(defaultsBefore({ kind: 'ok', value: 'x' }, 'claude-sonnet-5-5')).toBeNull()
  })

  test('sameDefaults compares both fields', () => {
    expect(sameDefaults({ model: 'opus', effort: 'high' }, { model: 'opus', effort: 'high' })).toBe(true)
    expect(sameDefaults({ model: 'opus', effort: 'high' }, { model: 'opus', effort: 'low' })).toBe(false)
  })
})

test('only a non-slash prompt counts as starting new work', () => {
  expect(isNewWork('幫我看這個 bug')).toBe(true)
  expect(isNewWork('/park')).toBe(false)
  expect(isNewWork('  ')).toBe(false)
})

describe('language', () => {
  test('an explicit choice wins over everything else', () => {
    expect(pickLocale({ option: 'en', claudeLanguage: '繁體中文', envLang: 'zh_TW.UTF-8' })).toBe('en')
    expect(pickLocale({ option: 'zh-TW', claudeLanguage: 'English', envLang: 'en_US.UTF-8' })).toBe('zh-TW')
  })

  test('auto follows Claude Code language, then the locale variables, then English', () => {
    expect(pickLocale({ option: 'auto', claudeLanguage: '繁體中文', envLang: 'en_US.UTF-8' })).toBe('zh-TW')
    expect(pickLocale({ option: 'auto', claudeLanguage: 'zh_TW', envLang: 'en_US.UTF-8' })).toBe('zh-TW')
    expect(pickLocale({ option: 'auto', claudeLanguage: 'English', envLang: 'zh_TW.UTF-8' })).toBe('en')
    expect(pickLocale({ option: 'auto', claudeLanguage: '日本語', envLang: 'zh_TW.UTF-8' })).toBe('zh-TW')
    expect(pickLocale({ option: undefined, claudeLanguage: 42, envLang: undefined })).toBe('en')
  })

  test('both tables say the same things', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  test('English output', () => {
    expect(en.button(1)).toBe('1 parked session')
    expect(en.button(3)).toBe('3 parked sessions')
    expect(pickTitle({ note: null, herdrTitle: null, aiTitle: null, firstPrompt: null }, en)).toBe('(untitled session)')
    expect(ageText(0, 3 * 3_600_000, en)).toBe('3 h ago')
    expect(modelLine('claude-opus-5-5', null, en)).toBe('claude-opus-5-5 · (effort not recorded)')
    expect(restoreReport({ model: 'claude-opus-5-5', effort: 'high' }, { model: 'claude-sonnet-5-5', effortError: null }, en)).toEqual([
      'model: wanted claude-opus-5-5, now claude-sonnet-5-5 ✗',
      'effort: set to high with /effort, confirmed on your next message',
    ])
    expect(writeBackPlan({ model: 'opus', effort: 'medium' }, { kind: 'missing' }, 'claude-sonnet-5-5', en).line).toBe('Defaults: settings.json is unreadable, nothing put back; check your /model and /effort defaults')
  })
})
