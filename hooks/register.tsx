import type { EngineInterface, On } from 'claude-code'
import {
  HERDR_TITLE_FILE,
  RECAP_DIR,
  STATE_FILE,
  aiTitleOf,
  ageText,
  defaultsOf,
  firstPromptOf,
  herdrTitleOf,
  isNewWork,
  modelLine,
  parseList,
  pickTitle,
  projectFolder,
  recapOf,
  restoreReport,
  sameDefaults,
  serialize,
  shownFor,
  upsert,
  without,
  withDefaults,
  type Defaults,
  type Entry,
  type Shown,
} from './park.ts'

const PANE = 'park-list'
// $.command.run is refused inside a command.run hook (it would wait on the held turn); a short timer runs it after
const DEFER_MS = 300
const SETTLE_MS = 800

const readOrNull = async ($: EngineInterface, path: string) => {
  try {
    return (await $.fs.exists(path)) ? await $.fs.read(path) : null
  } catch {
    return null
  }
}

const git = async ($: EngineInterface, cwd: string, args: readonly string[]) => {
  try {
    const run = await $.process.run(['git', ...args], { cwd, timeoutMs: 5_000 })
    return run.exitCode === 0 ? run.stdout.trim() || null : null
  } catch {
    return null
  }
}

const ancestors = (path: string) => {
  const out: string[] = []
  let dir = path
  while (dir.lastIndexOf('/') > 0) {
    dir = dir.slice(0, dir.lastIndexOf('/'))
    out.push(dir)
  }
  return out
}

const loadList = async ($: EngineInterface, path: string) => parseList(await readOrNull($, path))

const saveList = async ($: EngineInterface, path: string, list: readonly Entry[]) => {
  await $.process.run(['mkdir', '-p', path.slice(0, path.lastIndexOf('/'))])
  await $.fs.write(path, serialize(list))
}

const shownNow = async ($: EngineInterface, list: readonly Entry[], cwd: string) => {
  const paths = new Set(list.flatMap((entry) => [entry.dir, ...(entry.repoRoot === null ? [] : [entry.repoRoot]), ...ancestors(entry.dir)]))
  const existing = new Set<string>()
  for (const path of paths) if (await $.fs.exists(path)) existing.add(path)
  return shownFor(list, cwd, (path) => existing.has(path))
}

const closeList = ($: EngineInterface) => {
  void $.ui.close({ id: PANE })
  $.ui.invalidate('ui.render')
}

const runOrNull = async ($: EngineInterface, command: string, args: string) => {
  try {
    return (await $.command.run({ command, args })).text ?? null
  } catch (error) {
    return `失敗：${String(error)}`
  }
}

// In-place /resume does not bring back the parked session's model or effort, so set both after it lands
// settings.json is usually a symlink into ~/.claude; writing the link path could replace the link with a plain file
const settingsFile = async ($: EngineInterface, home: string) => {
  const link = `${(await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`}/settings.json`
  const real = await $.process.run(['realpath', link], { timeoutMs: 5_000 })
  return real.exitCode === 0 ? real.stdout.trim() : link
}

const readSettings = async ($: EngineInterface, path: string): Promise<unknown> => {
  const text = await readOrNull($, path)
  return text === null ? null : JSON.parse(text)
}

// Writing back a default leaves the running session alone (checked 2026-10-04: an outside edit of "model" did not switch the open session)
const putDefaultsBack = async ($: EngineInterface, path: string, model: string | null, before: Defaults): Promise<string> => {
  // /effort and /resume save after they reply; reading too early would see the old values and skip the repair
  await $.clock.sleep(SETTLE_MS)
  const settings = await readSettings($, path)
  const after = defaultsOf(settings, model)
  if (sameDefaults(before, after)) return '預設設定：沒被改動'
  await $.fs.write(path, `${JSON.stringify(withDefaults(settings, model, before), null, 2)}\n`)
  const check = defaultsOf(await readSettings($, path), model)
  return sameDefaults(before, check)
    ? `預設設定：接回改了它，已改回 model ${before.model ?? '（未設定）'}、${model} 的 effort ${before.effort ?? '（未設定）'} ✓`
    : `預設設定：改回失敗，現在 model ${check.model ?? '（未設定）'}、effort ${check.effort ?? '（未設定）'} ✗`
}

const resumeAndRestore = async ($: EngineInterface, entry: Entry, home: string) => {
  const path = await settingsFile($, home)
  const before = defaultsOf(await readSettings($, path), entry.model)
  await $.command.run({ command: 'resume', args: entry.id })
  if (entry.model !== null && (await $.session.model()) !== entry.model) await runOrNull($, 'model', entry.model)
  if (entry.effort !== null) await runOrNull($, 'effort', entry.effort)
  const lines = [`已接回：${entry.title}`, ...restoreReport(entry, { model: await $.session.model() }), await putDefaultsBack($, path, entry.model, before)]
  // One log call per line: a newline inside one entry renders as a replacement glyph in the transcript
  for (const line of lines) $.ui.log(line)
}

export function register(on: On) {
  let home: string | null = null
  let cwd = ''
  let shown: Shown[] = []
  // In memory on purpose: hiding is for this session only, the list on disk stays
  let active = false
  // The API has no effort getter; the last main-loop request carries it
  let lastEffort: string | null = null
  // Checked on the first request after a resume: the setting the model actually got, not what /effort replied
  let pendingCheck: { model: string | null; effort: string | null } | null = null

  let statePath = ''

  on('session.start', async ($, e, next) => {
    home = (await $.env.get('HOME')) ?? null
    if (home === null) return next(e)
    statePath = `${home}/${STATE_FILE}`
    await $.command.register({ name: 'park', description: '停泊這個 session，之後在同目錄開新 session 可接回', argumentHint: '[備註]' })
    try {
      cwd = await $.session.cwd()
      let list = await loadList($, statePath)
      // Our own id still listed means this session came back some other way (claude --resume, the /resume picker)
      const self = await $.session.id()
      if (list.some((entry) => entry.id === self)) {
        list = without(list, self)
        await saveList($, statePath, list)
      }
      shown = await shownNow($, list, cwd)
      active = shown.length > 0
      $.ui.invalidate('ui.render')
    } catch (error) {
      $.ui.log(`park: start failed ${JSON.stringify(String(error))}`, { to: 'debug' })
    }
    return next(e)
  })

  on('command.run', { command: 'park' }, async ($, e) => {
    if (home === null) return { text: 'park: 讀不到 HOME，沒有停泊' }
    const id = await $.session.id()
    const dir = await $.session.cwd()
    const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
    const commonDir = await git($, dir, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    const transcript = (await readOrNull($, `${configDir}/projects/${projectFolder(await $.session.root())}/${id}.jsonl`)) ?? (await readOrNull($, `${configDir}/projects/${projectFolder(dir)}/${id}.jsonl`))
    let firstPrompt: string | null = null
    try {
      firstPrompt = firstPromptOf(await $.session.messages())
    } catch {}
    const entry: Entry = {
      id,
      dir,
      repoRoot: commonDir?.endsWith('/.git') ? commonDir.slice(0, -'/.git'.length) : null,
      branch: await git($, dir, ['branch', '--show-current']),
      title: pickTitle({
        note: e.args,
        herdrTitle: herdrTitleOf(await readOrNull($, `${home}/${HERDR_TITLE_FILE}`), id),
        aiTitle: aiTitleOf(transcript),
        firstPrompt,
      }),
      ...recapOf(await readOrNull($, `${home}/${RECAP_DIR}/${id}.json`)),
      model: (await $.session.model()).trim() === '' ? null : await $.session.model(),
      effort: lastEffort,
      parkedAt: await $.clock.now(),
    }
    try {
      await saveList($, statePath, upsert(await loadList($, statePath), entry))
    } catch (error) {
      return { text: `park: 寫入清單失敗，沒有停泊：${String(error)}` }
    }
    $.clock.after(DEFER_MS, () => void $.command.run({ command: 'exit' }))
    return { text: `已停泊：${entry.title}` }
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      if (e.effort !== undefined) lastEffort = String(e.effort)
      if (pendingCheck !== null) {
        const wanted = pendingCheck
        pendingCheck = null
        const effort = e.effort === undefined ? '（無）' : String(e.effort)
        const ok = (wanted.model === null || wanted.model === e.model) && (wanted.effort === null || wanted.effort === effort)
        $.ui.log(`接回後第一則請求實際用：${e.model} · ${effort} ${ok ? '✓ 與停泊時一致' : `✗ 停泊時是 ${modelLine(wanted.model, wanted.effort)}`}`)
      }
    }
    return yield* next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (active && (e.origin.kind === 'composer' || e.origin.kind === 'bridge') && isNewWork(e.text)) {
      active = false
      closeList($)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!active || e.props.hasSurvey || e.surface !== 'terminal' || shown.length === 0) return next(e)
    const { Box, Button } = await $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Button key="park:open" label={`${shown.length} 個停泊的 session`} onPress={() => void $.ui.open({ id: PANE, title: '停泊的 session', focus: true, closeOnEscape: true })} />
        </Box>
        {await next(e)}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = await $.ui.resolve(e)
    const now = await $.clock.now()

    // Re-read before acting: another session in the same folder may have taken the entry already
    const resume = (entry: Shown) => {
      void (async () => {
        const list = await loadList($, statePath)
        if (!list.some((one) => one.id === entry.id)) {
          $.ui.toast('這筆已被接回或移除')
          shown = await shownNow($, list, cwd)
          $.ui.invalidate('ui.render')
          return
        }
        await saveList($, statePath, without(list, entry.id))
        active = false
        closeList($)
        $.clock.after(DEFER_MS, () =>
          void resumeAndRestore($, entry, home ?? '').then(
            () => {
              pendingCheck = { model: entry.model, effort: entry.effort }
            },
            (error) => $.ui.log(`接回失敗：${String(error)}`),
          ),
        )
      })()
    }

    const remove = (entry: Shown) => {
      void (async () => {
        const list = without(await loadList($, statePath), entry.id)
        await saveList($, statePath, list)
        shown = await shownNow($, list, cwd)
        if (shown.length > 0) return $.ui.invalidate('ui.render')
        active = false
        closeList($)
      })()
    }

    if (shown.length === 0) return <Text dimColor>沒有停泊的 session</Text>
    return (
      <Box flexDirection="column" rowGap={1}>
        {shown.map((entry) => (
          <Box key={`park:${entry.id}`} flexDirection="column">
            <Text bold wrap="truncate-end">{entry.title}</Text>
            {entry.goal === null ? null : <Text dimColor wrap="truncate-end">{`goal  ${entry.goal}`}</Text>}
            {entry.now === null ? null : <Text dimColor wrap="truncate-end">{`now   ${entry.now}`}</Text>}
            {entry.next === null ? null : <Text dimColor wrap="truncate-end">{`next  ${entry.next}`}</Text>}
            {modelLine(entry.model, entry.effort) === null ? null : <Text dimColor wrap="truncate-end">{`model ${modelLine(entry.model, entry.effort)}`}</Text>}
            <Text dimColor wrap="truncate-end">
              {[ageText(entry.parkedAt, now), entry.branch === null ? null : `⎇ ${entry.branch}`, entry.dirGone ? `原目錄已不存在：${entry.dir}` : null].filter((part) => part !== null).join('  ·  ')}
            </Text>
            <Box flexDirection="row" columnGap={1}>
              <Button key={`park:${entry.id}:resume`} label="接回" onPress={() => resume(entry)} />
              <Button key={`park:${entry.id}:remove`} label="移除" dimColor onPress={() => remove(entry)} />
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}
