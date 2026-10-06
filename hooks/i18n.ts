export type Locale = 'en' | 'zh-TW'

export type Strings = {
  commandDescription: string
  argumentHint: string
  noHome: string
  writeFailed: (error: string) => string
  parked: (title: string) => string
  untitled: string
  button: (n: number) => string
  paneTitle: string
  noParked: string
  resume: string
  remove: string
  alreadyTaken: string
  dirGone: (dir: string) => string
  minutesAgo: (n: number) => string
  hoursAgo: (n: number) => string
  daysAgo: (n: number) => string
  modelNotRecorded: string
  effortNotRecorded: string
  resumed: (title: string) => string
  resumeFailed: (error: string) => string
  modelNotRestored: string
  modelCheck: (wanted: string, actual: string | null, ok: boolean) => string
  effortNotRestored: string
  effortFailed: (effort: string, error: string) => string
  effortSet: (effort: string) => string
  firstRequest: (model: string, effort: string, mismatch: string | null) => string
  noEffort: string
  notSet: string
  defaultsUnknownBefore: string
  defaultsUnreadable: string
  defaultsUnchanged: string
  defaultsWriteFailed: (error: string) => string
  defaultsRestored: (model: string, modelName: string, effort: string) => string
  defaultsRestoreFailed: (model: string, effort: string) => string
  wrongSession: (landed: string) => string
  dropFailed: (error: string) => string
}

const STRINGS: Record<Locale, Strings> = {
  en: {
    commandDescription: 'Park this session; resume it later from a new session in the same folder',
    argumentHint: '[note]',
    noHome: 'park: HOME is not set, nothing parked',
    writeFailed: error => `park: could not write the list, nothing parked: ${error}`,
    parked: title => `Parked: ${title}`,
    untitled: '(untitled session)',
    button: n => `${n} parked session${n === 1 ? '' : 's'}`,
    paneTitle: 'Parked sessions',
    noParked: 'No parked sessions',
    resume: 'Resume',
    remove: 'Remove',
    alreadyTaken: 'Already resumed or removed',
    dirGone: dir => `folder no longer exists: ${dir}`,
    minutesAgo: n => `${n} min ago`,
    hoursAgo: n => `${n} h ago`,
    daysAgo: n => `${n} d ago`,
    modelNotRecorded: '(model not recorded)',
    effortNotRecorded: '(effort not recorded)',
    resumed: title => `Resumed: ${title}`,
    resumeFailed: error => `Resume failed: ${error}; the entry is kept`,
    modelNotRestored: 'model: not recorded when parked, not restored',
    modelCheck: (wanted, actual, ok) => `model: wanted ${wanted}, now ${actual ?? 'unknown'} ${ok ? '✓' : '✗'}`,
    effortNotRestored: 'effort: not recorded when parked, not restored',
    effortFailed: (effort, error) => `effort: /effort ${effort} failed (${error}), not restored ✗`,
    effortSet: effort => `effort: set to ${effort} with /effort, confirmed on your next message`,
    firstRequest: (model, effort, mismatch) => `First request after resume used: ${model} · ${effort} ${mismatch === null ? '✓ same as when parked' : `✗ parked with ${mismatch}`}`,
    noEffort: '(none)',
    notSet: '(not set)',
    defaultsUnknownBefore: 'Defaults: settings.json was unreadable before the resume, so changes were not checked',
    defaultsUnreadable: 'Defaults: settings.json is unreadable, nothing put back; check your /model and /effort defaults',
    defaultsUnchanged: 'Defaults: unchanged',
    defaultsWriteFailed: error => `Defaults: writing back failed (${error}); check your /model and /effort defaults ✗`,
    defaultsRestored: (model, modelName, effort) => `Defaults: the resume changed them; put back model ${model} and ${modelName} effort ${effort} ✓`,
    defaultsRestoreFailed: (model, effort) => `Defaults: putting back failed; now model ${model}, effort ${effort} ✗`,
    wrongSession: landed => `Parked list: this session is ${landed}, not the parked one; entry kept`,
    dropFailed: error => `Parked list: could not remove this entry (${error}); press Remove later`,
  },
  'zh-TW': {
    commandDescription: '停泊這個 session，之後在同目錄開新 session 可接回',
    argumentHint: '[備註]',
    noHome: 'park: 讀不到 HOME，沒有停泊',
    writeFailed: error => `park: 寫入清單失敗，沒有停泊：${error}`,
    parked: title => `已停泊：${title}`,
    untitled: '（未命名 session）',
    button: n => `${n} 個停泊的 session`,
    paneTitle: '停泊的 session',
    noParked: '沒有停泊的 session',
    resume: '接回',
    remove: '移除',
    alreadyTaken: '這筆已被接回或移除',
    dirGone: dir => `原目錄已不存在：${dir}`,
    minutesAgo: n => `${n} 分鐘前`,
    hoursAgo: n => `${n} 小時前`,
    daysAgo: n => `${n} 天前`,
    modelNotRecorded: '（model 未記錄）',
    effortNotRecorded: '（effort 未記錄）',
    resumed: title => `已接回：${title}`,
    resumeFailed: error => `接回失敗：${error}；停泊紀錄保留`,
    modelNotRestored: 'model：停泊時沒記錄，未還原',
    modelCheck: (wanted, actual, ok) => `model：要 ${wanted}，現在 ${actual ?? '讀不到'} ${ok ? '✓' : '✗'}`,
    effortNotRestored: 'effort：停泊時沒記錄，未還原',
    effortFailed: (effort, error) => `effort：/effort ${effort} 失敗（${error}），未還原 ✗`,
    effortSet: effort => `effort：已用 /effort 設為 ${effort}，送出下一則訊息時確認`,
    firstRequest: (model, effort, mismatch) => `接回後第一則請求實際用：${model} · ${effort} ${mismatch === null ? '✓ 與停泊時一致' : `✗ 停泊時是 ${mismatch}`}`,
    noEffort: '（無）',
    notSet: '（未設定）',
    defaultsUnknownBefore: '預設設定：接回前讀不到 settings.json，沒有檢查是否被改動',
    defaultsUnreadable: '預設設定：讀不到 settings.json，沒有改回；請自己確認 /model 與 /effort 的預設',
    defaultsUnchanged: '預設設定：沒被改動',
    defaultsWriteFailed: error => `預設設定：寫回失敗（${error}），請自己確認 /model 與 /effort 的預設 ✗`,
    defaultsRestored: (model, modelName, effort) => `預設設定：接回改了它，已改回 model ${model}、${modelName} 的 effort ${effort} ✓`,
    defaultsRestoreFailed: (model, effort) => `預設設定：改回失敗，現在 model ${model}、effort ${effort} ✗`,
    wrongSession: landed => `停泊清單：目前 session 是 ${landed}，不是停泊的那一筆，紀錄保留`,
    dropFailed: error => `停泊清單：沒能移除這一筆（${error}），之後可按「移除」`,
  },
}

export const stringsFor = (locale: Locale): Strings => STRINGS[locale]

const CHINESE = /中文|漢語|汉语|華語|华语|國語|国语|chinese|mandarin|^zh(?:[-_.\s]|$)/i
const ENGLISH = /英文|英語|english|^en(?:[-_.\s]|$)/i

/**
 * The UI language: the mod's own setting when it names one, then Claude Code's free-text
 * `language` setting, then LC_ALL / LANG; English when none of them says. Any Chinese maps to
 * Traditional Chinese, the only Chinese the mod ships.
 */
export function pickLocale(input: { option: unknown; claudeLanguage: unknown; envLang: string | undefined }): Locale {
  if (input.option === 'en' || input.option === 'zh-TW') return input.option
  if (typeof input.claudeLanguage === 'string') {
    const language = input.claudeLanguage.trim()
    if (CHINESE.test(language)) return 'zh-TW'
    if (ENGLISH.test(language)) return 'en'
  }
  return /^zh/i.test(input.envLang ?? '') ? 'zh-TW' : 'en'
}
