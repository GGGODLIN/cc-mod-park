import type { EngineInterface, Register } from 'claude-code'
import { pickLocale, stringsFor, type Strings } from './i18n.ts'
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
// English until session.start has read the language settings
let ui: Strings = stringsFor('en')

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
  const plan = writeBackPlan(before, await readSettings($, path), model, ui)
  if (plan.write === null) return plan.line
  try {
    await $.fs.write(path, `${JSON.stringify(plan.write, null, 2)}\n`)
  } catch (error) {
    return ui.defaultsWriteFailed(String(error))
  }
  const reread = await readSettings($, path)
  const check = defaultsOf(reread.kind === 'ok' ? reread.value : null, model)
  return before !== null && sameDefaults(before, check)
    ? ui.defaultsRestored(before.model ?? ui.notSet, model ?? ui.notSet, before.effort ?? ui.notSet)
    : ui.defaultsRestoreFailed(check.model ?? ui.notSet, check.effort ?? ui.notSet)
}

// The entry leaves the list only once this session is the parked one; a stale entry costs a click, a lost one loses the bookmark
const dropIfLanded = async ($: EngineInterface, entry: Entry, statePath: string): Promise<string | null> => {
  const landed = await $.session.id()
  if (landed !== entry.id) return ui.wrongSession(landed)
  try {
    await saveList($, statePath, without(await loadList($, statePath), entry.id))
    return null
  } catch (error) {
    return ui.dropFailed(String(error))
  }
}

// Throws only when /resume itself fails, so the caller keeps the entry; later failures become report lines
const resumeAndRestore = async ($: EngineInterface, entry: Entry, home: string, statePath: string) => {
  const path = await settingsFile($, home)
  const before = defaultsBefore(await readSettings($, path), entry.model)
  await $.command.run({ command: 'resume', args: entry.id })
  if (entry.model !== null && (await $.session.model()) !== entry.model) await runError($, 'model', entry.model)
  const effortError = entry.effort === null ? null : await runError($, 'effort', entry.effort)
  const report = restoreReport(entry, { model: await $.session.model(), effortError }, ui)
  const defaultsLine = await putDefaultsBack($, path, entry.model, before)
  const listLine = await dropIfLanded($, entry, statePath)
  const lines = [ui.resumed(entry.title), ...report, defaultsLine, ...(listLine === null ? [] : [listLine])]
  // One log call per line: a newline inside one entry renders as a replacement glyph in the transcript
  for (const line of lines) $.ui.log(line)
}

export const register: Register = (on, options) => {
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
    // An empty LC_ALL means unset to the C library, so it must not hide LANG
    const lcAll = await $.env.get('LC_ALL')
    const envLang = lcAll !== undefined && lcAll !== '' ? lcAll : await $.env.get('LANG')
    const settings = await readSettings($, await settingsFile($, home))
    const claudeLanguage = settings.kind === 'ok' ? (settings.value as { language?: unknown } | null)?.language : undefined
    ui = stringsFor(pickLocale({ option: options.language, claudeLanguage, envLang }))
    await $.command.register({ name: 'park', description: ui.commandDescription, argumentHint: ui.argumentHint })
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
    if (home === null) return { text: ui.noHome }
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
      }, ui),
      ...recapOf(await readOrNull($, `${home}/${RECAP_DIR}/${id}.json`)),
      model: (await $.session.model()).trim() === '' ? null : await $.session.model(),
      effort: lastEffort,
      parkedAt: await $.clock.now(),
    }
    try {
      await saveList($, statePath, upsert(await loadList($, statePath), entry))
    } catch (error) {
      return { text: ui.writeFailed(String(error)) }
    }
    $.clock.after(DEFER_MS, () => void $.command.run({ command: 'exit' }))
    return { text: ui.parked(entry.title) }
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      if (e.effort !== undefined) lastEffort = String(e.effort)
      if (pendingCheck !== null) {
        const wanted = pendingCheck
        pendingCheck = null
        const effort = e.effort === undefined ? ui.noEffort : String(e.effort)
        const ok = (wanted.model === null || wanted.model === e.model) && (wanted.effort === null || wanted.effort === effort)
        $.ui.log(ui.firstRequest(e.model, effort, ok ? null : modelLine(wanted.model, wanted.effort, ui)))
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
          <Button key="park:open" label={ui.button(shown.length)} onPress={() => void $.ui.open({ id: PANE, title: ui.paneTitle, focus: true, closeOnEscape: true })} />
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
          $.ui.toast(ui.alreadyTaken)
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
            (error) => $.ui.log(ui.resumeFailed(String(error))),
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

    if (shown.length === 0) return <Text dimColor>{ui.noParked}</Text>
    return (
      <Box flexDirection="column" rowGap={1}>
        {shown.map((entry) => (
          <Box key={`park:${entry.id}`} flexDirection="column">
            <Text bold wrap="truncate-end">{entry.title}</Text>
            {entry.goal === null ? null : <Text dimColor wrap="truncate-end">{`goal  ${entry.goal}`}</Text>}
            {entry.now === null ? null : <Text dimColor wrap="truncate-end">{`now   ${entry.now}`}</Text>}
            {entry.next === null ? null : <Text dimColor wrap="truncate-end">{`next  ${entry.next}`}</Text>}
            {modelLine(entry.model, entry.effort, ui) === null ? null : <Text dimColor wrap="truncate-end">{`model ${modelLine(entry.model, entry.effort, ui)}`}</Text>}
            <Text dimColor wrap="truncate-end">
              {[ageText(entry.parkedAt, now, ui), entry.branch === null ? null : `⎇ ${entry.branch}`, entry.dirGone ? ui.dirGone(entry.dir) : null].filter((part) => part !== null).join('  ·  ')}
            </Text>
            <Box flexDirection="row" columnGap={1}>
              <Button key={`park:${entry.id}:resume`} label={ui.resume} onPress={() => resume(entry)} />
              <Button key={`park:${entry.id}:remove`} label={ui.remove} dimColor onPress={() => remove(entry)} />
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}
