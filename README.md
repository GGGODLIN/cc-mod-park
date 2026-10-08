# cc-mod-park

English | [繁體中文](/README.zh-TW.md)

Park a Claude Code session you will come back to, then pick it up again from a new session in the same folder with one click. Neither step goes through the model.

https://github.com/user-attachments/assets/b186dbce-2c2f-462c-a509-cecfa45d9858

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

- Tested on Claude Code 2.1.288 and 2.1.289, on macOS; loading checked on 2.1.290; `/park <note>` checked on 2.1.292 and 2.1.294. Function hooks are a newer surface of Claude Code, and later versions may change it.
- If another mod's `AbovePrompt` handler returns its own element without calling `next(e)`, the park button does not show, with no error.
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
