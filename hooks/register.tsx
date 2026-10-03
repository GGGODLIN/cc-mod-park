import type { EngineInterface, On } from 'claude-code'
import {
  HERDR_TITLE_FILE,
  RECAP_DIR,
  STATE_FILE,
  aiTitleOf,
  ageText,
  firstPromptOf,
  herdrTitleOf,
  isNewWork,
  parseList,
  pickTitle,
  projectFolder,
  recapOf,
  serialize,
  shownFor,
  upsert,
  without,
  type Entry,
  type Shown,
} from './park.ts'

const PANE = 'park-list'
// $.command.run is refused inside a command.run hook (it would wait on the held turn); a short timer runs it after
const DEFER_MS = 300

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

export function register(on: On) {
  let home: string | null = null
  let cwd = ''
  let shown: Shown[] = []
  // In memory on purpose: hiding is for this session only, the list on disk stays
  let active = false

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
        $.clock.after(DEFER_MS, () => void $.command.run({ command: 'resume', args: entry.id }))
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
