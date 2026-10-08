# cc-mod-park

[English](/README.md) | 繁體中文

把還沒做完的 Claude Code session 停起來，之後在同一個資料夾開新 session，點一下就接回去。停泊和接回都不經過模型。

https://github.com/user-attachments/assets/878b33a8-cf31-462f-8019-1daf972bfc79

適用情境：週五事情沒做完，不想讓 session 開著過週末，也怕重開機後找不回來。打 `/park` 就關機，週一在同一個資料夾開 `claude` 即可。

session 開著也有成本：在作者的機器上，每個閒置 session 約佔 600MB 記憶體（7 個 session 共 4.4GB，2026-10-05 量測）。如果你同時開多個會互傳訊息的 session，閒置的那個還可能被訊息喚醒、跑一整輪來回覆，prompt cache 過期後就是全價。

## 運作方式

1. `/park [備註]` 把 session 記進 `~/.local/state/cc-mod-park/parked.json`，然後自動結束。每一筆包含 session id、資料夾與 repo 根目錄、git 分支、標題、model、effort；作者自己的 recap 檔存在時，也會存它的 goal／now／next。這些可能含工作內容，請把這個檔當成對話紀錄一樣看待。
2. 在同一個資料夾開新 session，輸入框上方會出現「N 個停泊的 session」按鈕。
3. 按下去會打開右側面板。按「接回」會就地執行 `/resume`，按「移除」會把那一筆刪掉。
4. 接回後會回報當初的 model 與 effort。如果 `/resume` 改掉了 `settings.json` 裡的預設 model 或 effort，會自動寫回原值。

送出第一則不是斜線指令的訊息後，按鈕就會藏起來。

## 語言

介面有英文與繁體中文。預設 `auto`：先看 Claude Code `settings.json` 的 `language`（例如「繁體中文」），再看 `LC_ALL`／`LANG`，都沒有就用英文；任何中文都顯示繁體中文。語言在 session 啟動時讀一次。要固定語言，在 `/config` 找到這個 plugin 的 Language 選 `en` 或 `zh-TW`。

## 為什麼不直接用 `/resume`

原生 `/resume` 的選單列出所有 session，過幾天就分不出哪些做完了、哪些還要接。`/park` 是在你還記得的時候先做好標記，清單裡只有你標過「還沒做完」的 session，接回後就移出清單。

## 為什麼做成 mod、不做成一般 slash command

一般自訂指令（`commands/*.md`）會展開成 prompt 交給模型，停泊一次就要花一輪，接回後的對話裡也會留著那段請求。mod 註冊的 `/park` 由程式自己處理，跟 `/cost` 一樣不會讓模型跑一輪。對話裡會留下一行結果，模型之後讀得到。接回用的按鈕和右側面板也只有 mod 畫得出來。

## 安裝

```sh
claude plugin marketplace add GGGODLIN/cc-mod-park
claude plugin install cc-mod-park@cc-mod-park
```

安裝後新開的 session 會載入。Claude Code 2.1.290 不必另外設定就會載入 mod（2026-10-06 在沒設 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` 的情況下確認）。目前在 macOS 上的 Claude Code 2.1.288 與 2.1.289 實測過，2.1.290 只確認過會載入，`/park <筆記>` 在 2.1.292 與 2.1.294 確認過。

## 已知限制

- 用 `claude --resume` 開新程序接回，清單會移除那一筆；在已開著的 session 裡用 `/resume` 選單切過去則不會，要自己按「移除」。
- 所有 session 共用同一個清單檔，每次整份寫入。兩個 session 同一瞬間停泊或接回，可能掉其中一筆變更。
- 清單檔放在 `$HOME` 底下，不跟著 `CLAUDE_CONFIG_DIR` 分開。
- 如果別的 mod 在 `AbovePrompt` 回傳自己的元件、沒有呼叫 `next(e)`，停泊按鈕就不會出現，也不會報錯。
- 接回後如果 `settings.json` 的預設 model／effort 被改掉，會寫回原值；同一秒內別的 session 或你自己改的也會被寫回。讀不到 `settings.json` 時不寫入，結果那行會說明。
