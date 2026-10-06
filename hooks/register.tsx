import type { EngineInterface, On } from 'claude-code'
import {
  HERDR_TITLE_FILE,
  RECAP_DIR,
  STATE_FILE,
  aiTitleOf,
  ageText,
  defaultsBefore,
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
  writeBackPlan,
  type Defaults,
  type Entry,
  type SettingsRead,
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

// The error text, or null when the command ran
const runError = async ($: EngineInterface, command: string, args: string) => {
  try {
    await $.command.run({ command, args })
    return null
  } catch (error) {
    return String(error)
  }
}

// In-place /resume does not bring back the parked session's model or effort, so set both after it lands
// settings.json is usually a symlink into ~/.claude; writing the link path could replace the link with a plain file
const settingsFile = async ($: EngineInterface, home: string) => {
  const link = `${(await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`}/settings.json`
  const real = await $.process.run(['realpath', link], { timeoutMs: 5_000 })
  return real.exitCode === 0 ? real.stdout.trim() : link
}

const readSettings = async ($: EngineInterface, path: string): Promise<SettingsRead> => {
  try {
    if (!(await $.fs.exists(path))) return { kind: 'missing' }
    return { kind: 'ok', value: JSON.parse(await $.fs.read(path)) }
  } catch {
    return { kind: 'unreadable' }
  }
}

// Writing back a default leaves the running session alone (checked 2026-10-04: an outside edit of "model" did not switch the open session)
// Another writer changing model or effort in the same window is also put back: the file alone cannot tell who changed it
const putDefaultsBack = async ($: EngineInterface, path: string, model: string | null, before: Defaults | null): Promise<string> => {
  // /effort and /resume save after they reply; reading too early would see the old values and skip the repair
  await $.clock.sleep(SETTLE_MS)
  const plan = writeBackPlan(before, await readSettings($, path), model)
  if (plan.write === null) return plan.line
  try {
    await $.fs.write(path, `${JSON.stringify(plan.write, null, 2)}\n`)
  } catch (error) {
    return `預設設定：寫回失敗（${String(error)}），請自己確認 /model 與 /effort 的預設 ✗`
  }
  const reread = await readSettings($, path)
  const check = defaultsOf(reread.kind === 'ok' ? reread.value : null, model)
  return before !== null && sameDefaults(before, check)
    ? `預設設定：接回改了它，已改回 model ${before.model ?? '（未設定）'}、${model} 的 effort ${before.effort ?? '（未設定）'} ✓`
    : `預設設定：改回失敗，現在 model ${check.model ?? '（未設定）'}、effort ${check.effort ?? '（未設定）'} ✗`
}

// The entry leaves the list only once this session is the parked one; a stale entry costs a click, a lost one loses the bookmark
const dropIfLanded = async ($: EngineInterface, entry: Entry, statePath: string): Promise<string | null> => {
  const landed = await $.session.id()
  if (landed !== entry.id) return `停泊清單：目前 session 是 ${landed}，不是停泊的那一筆，紀錄保留`
  try {
    await saveList($, statePath, without(await loadList($, statePath), entry.id))
    return null
  } catch (error) {
    return `停泊清單：沒能移除這一筆（${String(error)}），之後可按「移除」`
  }
}

// Throws only when /resume itself fails, so the caller keeps the entry; later failures become report lines
const resumeAndRestore = async ($: EngineInterface, entry: Entry, home: string, statePath: string) => {
  const path = await settingsFile($, home)
  const before = defaultsBefore(await readSettings($, path), entry.model)
  await $.command.run({ command: 'resume', args: entry.id })
  if (entry.model !== null && (await $.session.model()) !== entry.model) await runError($, 'model', entry.model)
  const effortError = entry.effort === null ? null : await runError($, 'effort', entry.effort)
  const report = restoreReport(entry, { model: await $.session.model(), effortError })
  const defaultsLine = await putDefaultsBack($, path, entry.model, before)
  const listLine = await dropIfLanded($, entry, statePath)
  const lines = [`已接回：${entry.title}`, ...report, defaultsLine, ...(listLine === null ? [] : [listLine])]
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
        // The entry leaves the list only after the resume lands (in resumeAndRestore), so a failed one keeps the bookmark
        active = false
        closeList($)
        $.clock.after(DEFER_MS, () =>
          void resumeAndRestore($, entry, home ?? '', statePath).then(
            () => {
              pendingCheck = { model: entry.model, effort: entry.effort }
            },
            (error) => $.ui.log(`接回失敗：${String(error)}；停泊紀錄保留`),
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
