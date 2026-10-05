# cc-mod-park

Park a Claude Code session you will come back to, then pick it up again from a new session in the same folder with one click. Neither step goes through the model.

https://github.com/user-attachments/assets/878b33a8-cf31-462f-8019-1daf972bfc79

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

## Why not just `/resume`

The `/resume` picker lists every past session, finished or not. A week later you cannot tell which ones you meant to come back to. `/park` is that decision, made while you still remember it: the list holds only the sessions you marked as unfinished, in the folder you left them, and an entry leaves the list once you pick it up.

## Why a mod, not a slash command

A custom slash command (`commands/*.md`) is a prompt: running it wakes the model and leaves the expansion in the context. Parking a session should not cost a turn, and a resumed session should not carry a "please park me" exchange in its history.

A mod registers `/park` as a command whose handler answers on its own, the way `/cost` does, so nothing reaches the model and nothing is added to the context except the one-line result. The resume side needs a mod too: the button above the prompt and the side pane are UI that only a mod can draw.

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

為什麼不直接用 `/resume`：原生 `/resume` 的選單列出所有 session，過幾天就分不出哪些做完了、哪些還要接。`/park` 是在你還記得的時候先做好標記，清單裡只有你標過「還沒做完」的 session，接回後就移出清單。

為什麼做成 mod、不做成一般 slash command：一般自訂指令（`commands/*.md`）會展開成 prompt 交給模型，停泊一次就要花一輪，接回後的對話裡也會留著那段請求。mod 註冊的 `/park` 由程式自己處理，跟 `/cost` 一樣不經模型，對話裡只留一行結果。接回用的按鈕和右側面板也只有 mod 畫得出來。

安裝前要先在 `settings.json` 的 `env` 加 `"CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"`，再執行上面的兩行 `claude plugin` 指令。目前只在 macOS 上的 Claude Code 2.1.288 與 2.1.289 實測過。
