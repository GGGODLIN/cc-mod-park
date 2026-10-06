# cc-mod-park

Park a Claude Code session you will come back to, then pick it up again from a new session in the same folder with one click. Neither step goes through the model.

https://github.com/user-attachments/assets/878b33a8-cf31-462f-8019-1daf972bfc79

Typical use: it is Friday, the work is not done, and you do not want the session sitting open all weekend or lost after a reboot. Type `/park`, close the laptop, and on Monday start `claude` in the same folder.

Keeping a session open is not free. On the author's machine each idle session held about 600 MB of memory (7 sessions, 4.4 GB in total, measured 2026-10-05). And if you run several sessions that message each other, an idle one can be woken to answer, spending a full turn, at full price once its prompt cache has expired.

## How it works

1. `/park [note]` records the session to `~/.local/state/cc-mod-park/parked.json`, then exits. An entry holds the session id, its folder and repo root, the git branch, the title, model and effort, and, when the author's recap file exists, its goal / now / next lines. That can include work details, so treat the file like your transcripts.
2. A new session started in the same folder shows an "N parked sessions" button above the prompt.
3. The button opens a side pane listing the parked sessions, newest first. "Resume" runs `/resume` in place; "Remove" drops the entry.
4. After the resume, the model and effort the session had when parked are reported, and your default model and effort in `settings.json` are put back if the resume changed them.

The button hides once you send your first prompt that is not a slash command, so it stays out of the way of new work.

Details:

- The list matches the folder exactly. A session parked in `repo/sub` shows up in `repo/sub`, not in `repo`.
- If the parked folder no longer exists (for example, a removed git worktree), the entry shows at its repo root, or else at the nearest existing parent folder.
- Starting a parked session with `claude --resume` in a new process removes it from the list. Switching to it with the `/resume` picker inside a session that is already open does not, because a mod gets no start event for that switch; remove the entry by hand.
- The title comes from, in order: your `/park` note, a Herdr pane title, the session's AI title, or the first prompt. The Herdr and recap sources are files from the author's own setup (`~/.local/state/herdr-session-title/state.json`, `~/.cache/cc-recap/<id>.json`); when they are missing they are skipped.

## Why not just `/resume`

The `/resume` picker lists every past session, finished or not. A week later you cannot tell which ones you meant to come back to. `/park` is that decision, made while you still remember it: the list holds only the sessions you marked as unfinished, in the folder you left them, and an entry leaves the list once you pick it up.

## Why a mod, not a slash command

A custom slash command (`commands/*.md`) is a prompt: running it wakes the model and leaves the expansion in the context. Parking a session should not cost a turn, and a resumed session should not carry a "please park me" exchange in its history.

A mod registers `/park` as a command whose handler answers on its own, the way `/cost` does, so parking does not start a model turn. The one-line result does stay in the conversation, where the model can read it later. The resume side needs a mod too: the button above the prompt and the side pane are UI that only a mod can draw.

## Install

This is a Claude Code mod: a plugin made of function hooks. On Claude Code 2.1.290 mods load without any extra setting (checked 2026-10-06 with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` unset). Install the plugin:

```sh
claude plugin marketplace add GGGODLIN/cc-mod-park
claude plugin install cc-mod-park@cc-mod-park
```

Sessions started after the install load it.

## Language

The UI comes in English and Traditional Chinese. The default `auto` follows the `language` in Claude Code's `settings.json` (for example `繁體中文`), then `LC_ALL` / `LANG`, and falls back to English; any Chinese shows Traditional Chinese. The language is read once, when a session starts. To pin a language, open `/config`, find this plugin's Language, and pick `en` or `zh-TW`.

## Known limits

- Tested on Claude Code 2.1.288 and 2.1.289, on macOS; loading checked on 2.1.290. Function hooks are a newer surface of Claude Code, and later versions may change it.
- Every session shares one list file, written whole each time. Two sessions parking or resuming in the same moment can drop one of the changes.
- The list file lives under `$HOME`, not under `CLAUDE_CONFIG_DIR`, so separate config folders for the same user share one list.
- After Resume, your default model and effort in `settings.json` are put back if they changed. A change another session or you made in that same second is put back too, since the file cannot tell who changed it. If `settings.json` cannot be read, nothing is written and the result line says so.
- `/park` typed while the model is still answering gets queued and then dropped. Wait for the turn to end, then type it.
- To reach the button by keyboard, press `ctrl+x tab` to move into the row above the prompt. Focus may land on another mod's button first.
- After Resume, the old conversation takes a few seconds to appear. The status line shows the restored model only after the next message.

## Development

```sh
bun test
```

To try local changes, bump `version` in `.claude-plugin/plugin.json` and run `claude plugin update cc-mod-park@cc-mod-park`. The install is a cached copy, so edits to the working tree do not take effect on their own.

---

## 中文說明

把還沒做完的 Claude Code session 停起來，之後在同一個資料夾開新 session，點一下就接回去。停泊和接回都不經過模型。

適用情境：週五事情沒做完，不想讓 session 開著過週末，也怕重開機後找不回來。打 `/park` 就關機，週一在同一個資料夾開 `claude` 即可。

session 開著也有成本：在作者的機器上，每個閒置 session 約佔 600MB 記憶體（7 個 session 共 4.4GB，2026-10-05 量測）。如果你同時開多個會互傳訊息的 session，閒置的那個還可能被訊息喚醒、跑一整輪來回覆，prompt cache 過期後就是全價。

1. `/park [備註]` 把 session 記進 `~/.local/state/cc-mod-park/parked.json`，然後自動結束。每一筆包含 session id、資料夾與 repo 根目錄、git 分支、標題、model、effort；作者自己的 recap 檔存在時，也會存它的 goal／now／next。這些可能含工作內容，請把這個檔當成對話紀錄一樣看待。
2. 在同一個資料夾開新 session，輸入框上方會出現「N 個停泊的 session」按鈕。
3. 按下去會打開右側面板。按「接回」會就地執行 `/resume`，按「移除」會把那一筆刪掉。
4. 接回後會回報當初的 model 與 effort。如果 `/resume` 改掉了 `settings.json` 裡的預設 model 或 effort，會自動寫回原值。

送出第一則不是斜線指令的訊息後，按鈕就會藏起來。

介面有英文與繁體中文。預設 `auto`：先看 Claude Code `settings.json` 的 `language`（例如「繁體中文」），再看 `LC_ALL`／`LANG`，都沒有就用英文；任何中文都顯示繁體中文。語言在 session 啟動時讀一次。要固定語言，在 `/config` 找到這個 plugin 的 Language 選 `en` 或 `zh-TW`。

為什麼不直接用 `/resume`：原生 `/resume` 的選單列出所有 session，過幾天就分不出哪些做完了、哪些還要接。`/park` 是在你還記得的時候先做好標記，清單裡只有你標過「還沒做完」的 session，接回後就移出清單。

為什麼做成 mod、不做成一般 slash command：一般自訂指令（`commands/*.md`）會展開成 prompt 交給模型，停泊一次就要花一輪，接回後的對話裡也會留著那段請求。mod 註冊的 `/park` 由程式自己處理，跟 `/cost` 一樣不會讓模型跑一輪。對話裡會留下一行結果，模型之後讀得到。接回用的按鈕和右側面板也只有 mod 畫得出來。

安裝只要執行上面的兩行 `claude plugin` 指令。Claude Code 2.1.290 不必另外設定就會載入 mod（2026-10-06 在沒設 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` 的情況下確認）。目前在 macOS 上的 Claude Code 2.1.288 與 2.1.289 實測過，2.1.290 只確認過會載入。

已知限制：

- 用 `claude --resume` 開新程序接回，清單會移除那一筆；在已開著的 session 裡用 `/resume` 選單切過去則不會，要自己按「移除」。
- 所有 session 共用同一個清單檔，每次整份寫入。兩個 session 同一瞬間停泊或接回，可能掉其中一筆變更。
- 清單檔放在 `$HOME` 底下，不跟著 `CLAUDE_CONFIG_DIR` 分開。
- 接回後如果 `settings.json` 的預設 model／effort 被改掉，會寫回原值；同一秒內別的 session 或你自己改的也會被寫回。讀不到 `settings.json` 時不寫入，結果那行會說明。
