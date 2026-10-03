import { describe, expect, test } from 'bun:test'
import { aiTitleOf, ageText, firstPromptOf, herdrTitleOf, isNewWork, modelLine, parseList, pickTitle, projectFolder, recapOf, restoreReport, serialize, shownFor, upsert, without, type Entry } from '../hooks/park.ts'

const entry = (over: Partial<Entry>): Entry => ({ id: 's1', dir: '/w/repo', repoRoot: '/w/repo', branch: 'main', title: 't', goal: null, now: null, next: null, model: null, effort: null, parkedAt: 0, ...over })
const existsIn = (paths: string[]) => (path: string) => paths.includes(path)

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
    const list = [entry({ id: 'here-old', parkedAt: 1 }), entry({ id: 'child', dir: '/w/repo/sub' }), entry({ id: 'other', dir: '/w/calyx', repoRoot: null }), entry({ id: 'here-new', parkedAt: 2 })]
    const shown = shownFor(list, '/w/repo', existsIn(['/w/repo', '/w/repo/sub', '/w/calyx']))
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
    expect(pickTitle({ ...base, note: ' 週一接 ', herdrTitle: 'H' })).toBe('週一接')
    expect(pickTitle({ ...base, note: '', herdrTitle: 'H', aiTitle: 'A' })).toBe('H')
    expect(pickTitle({ ...base, aiTitle: 'A', firstPrompt: 'P' })).toBe('A')
    expect(pickTitle({ ...base, firstPrompt: '一'.repeat(45) })).toBe(`${'一'.repeat(40)}…`)
    expect(pickTitle(base)).toBe('（未命名 session）')
  })

  test('herdr title and recap read tolerantly', () => {
    expect(herdrTitleOf(JSON.stringify({ s1: { name: 'Calyx Session Resume' }, s2: { name: '' } }), 's1')).toBe('Calyx Session Resume')
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
  expect(ageText(0, 59 * 60_000)).toBe('59 分鐘前')
  expect(ageText(0, 3 * 3_600_000)).toBe('3 小時前')
  expect(ageText(0, 2.5 * 86_400_000)).toBe('2 天前')
})

test('model line shows what was recorded and marks what was not', () => {
  expect(modelLine('claude-opus-5-5', 'high')).toBe('claude-opus-5-5 · high')
  expect(modelLine('claude-opus-5-5', null)).toBe('claude-opus-5-5 · （effort 未記錄）')
  expect(modelLine(null, null)).toBeNull()
})

test('restore report marks a model mismatch and passes the /effort reply through', () => {
  expect(restoreReport({ model: 'claude-opus-5-5', effort: 'high' }, { model: 'claude-opus-5-5', effortReply: 'Set effort level to high' })).toEqual([
    'model：要 claude-opus-5-5，現在 claude-opus-5-5 ✓',
    'effort：要 high，/effort 回應「Set effort level to high」',
  ])
  expect(restoreReport({ model: 'claude-opus-5-5', effort: null }, { model: 'claude-sonnet-5-5', effortReply: null })).toEqual([
    'model：要 claude-opus-5-5，現在 claude-sonnet-5-5 ✗',
    'effort：停泊時沒記錄，未還原',
  ])
})

test('only a non-slash prompt counts as starting new work', () => {
  expect(isNewWork('幫我看這個 bug')).toBe(true)
  expect(isNewWork('/park')).toBe(false)
  expect(isNewWork('  ')).toBe(false)
})
