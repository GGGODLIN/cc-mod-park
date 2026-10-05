# cc-mod-park

Park a Claude Code session you will come back to, then pick it up again from a new session in the same folder with one click. Neither step goes through the model.

Typical use: it is Friday, the work is not done, and you do not want the session sitting open all weekend or lost after a reboot. Type `/park`, close the laptop, and on Monday start `claude` in the same folder.

## How it works

1. `/park [note]` records the session (title, git branch, model, effort) to `~/.local/state/cc-mod-park/parked.json`, then exits.
2. A new session started in the same folder shows a "N 個停泊的 session" (N parked sessions) button above the prompt.
3. The button opens a side pane listing the parked sessions, newest first. "接回" (resume) runs `/resume` in place; "移除" (remove) drops the entry.
4. After the resume, the model and effort the session had when parked are reported, and your default model and effort in `settings.json` are put back if the resume changed them.

The button hides once you send your first prompt that is not a slash command, so it stays out of the way of new work.

Details:

- The list matches the folder exactly. A session parked in `repo/sub` shows up in `repo/sub`, not in `repo`.
- If the parked folder no longer exists (for example, a removed git worktree), the entry shows at its repo root, or else at the nearest existing parent folder.
- Resuming a parked session any other way (`claude --resume`, the `/resume` picker) removes it from the list.
- The title comes from, in order: your `/park` note, a Herdr pane title, the session's AI title, or the first prompt. The Herdr and recap sources are files from the author's own setup (`~/.local/state/herdr-session-title/state.json`, `~/.cache/cc-recap/<id>.json`); when they are missing they are skipped.

## Install

This is a Claude Code mod: a plugin made of function hooks. Function hooks are off by default, so turn them on first in `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"
  }
}
```

Then install the plugin:

```sh
claude plugin marketplace add GGGODLIN/cc-mod-park
claude plugin install cc-mod-park@cc-mod-park
```

Sessions started after the install load it.

## Known limits

- Tested only on Claude Code 2.1.288 and 2.1.289, on macOS. Function hooks are a newer surface of Claude Code, and later versions may change it.
- The UI text is in Traditional Chinese.
- `/park` typed while the model is still answering gets queued and then dropped. Wait for the turn to end, then type it.
- To reach the button by keyboard, press `ctrl+x tab` to move into the row above the prompt. Focus may land on another mod's button first.
- After "接回", the old conversation takes a few seconds to appear. The status line shows the restored model only after the next message.

## Development

```sh
bun test
```

To try local changes, bump `version` in `.claude-plugin/plugin.json` and run `claude plugin update cc-mod-park@cc-mod-park`. The install is a cached copy, so edits to the working tree do not take effect on their own.

---

## 中文說明

把還沒做完的 Claude Code session 停起來，之後在同一個資料夾開新 session，點一下就接回去。停泊和接回都不經過模型。

適用情境：週五事情沒做完，不想讓 session 開著過週末，也怕重開機後找不回來。打 `/park` 就關機，週一在同一個資料夾開 `claude` 即可。

1. `/park [備註]` 把 session 的標題、git 分支、model、effort 記進 `~/.local/state/cc-mod-park/parked.json`，然後自動結束。
2. 在同一個資料夾開新 session，輸入框上方會出現「N 個停泊的 session」按鈕。
3. 按下去會打開右側面板。按「接回」會就地執行 `/resume`，按「移除」會把那一筆刪掉。
4. 接回後會回報當初的 model 與 effort。如果 `/resume` 改掉了 `settings.json` 裡的預設 model 或 effort，會自動寫回原值。

送出第一則不是斜線指令的訊息後，按鈕就會藏起來。

安裝前要先在 `settings.json` 的 `env` 加 `"CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"`，再執行上面的兩行 `claude plugin` 指令。目前只在 macOS 上的 Claude Code 2.1.288 與 2.1.289 實測過。
