# 00953B 不定期不定額：參數流程圖

一個 Cloudflare Worker 同時提供：

- **網頁**：`public/index.html`（靜態檔）
- **雲端同步**：`src/worker.js`，路徑 `/api/state`，數據存在 Cloudflare KV

## 檔案結構

```
├─ wrangler.jsonc     設定：靜態檔資料夾、程式進入點、KV 綁定
├─ public/
│  └─ index.html      網頁
└─ src/
   └─ worker.js       同步服務
```

## 第一次部署

1. **建立 KV**：Cloudflare 後台 → Storage & Databases → KV → Create，名稱隨意（例如 `00953b-state`）。
   建好後複製它的 **ID**，貼到 `wrangler.jsonc` 的 `"id"` 欄位，commit 並 push。
2. **匯入 GitHub**：Workers & Pages → Create → Import a repository → 選這個 repository。
   Worker 名稱要填 `wrangler.jsonc` 裡的 `name`（預設 `00953b`），其餘用預設值即可，部署指令是 `npx wrangler deploy`。
3. **開始使用**：打開 Worker 的網址，在左邊「雲端同步」自己取一把 20 字元以上的金鑰，按「儲存金鑰並同步」。
   其他裝置打開同一個網址、填同一把金鑰即可。

## 同步金鑰

- 每把金鑰各存一組數據，不用到後台設定。換成一把新金鑰時，會用這台裝置目前的數據建立新的一組。
- 金鑰就是讀寫那組數據的唯一憑證，請用不好猜的隨機字串，不要給別人。
- 任何知道網址的人都能用自己的金鑰寫入這個 KV。
- 舊版只有一組數據；如果後台還留著 Secret `SYNC_TOKEN`，用那把金鑰同步會沿用舊版數據。

## 之後更新網頁

直接修改 `public/index.html` 後 push，Cloudflare 會自動重新部署。KV 裡的數據不受影響。

## 注意

- KV 綁定請寫在 `wrangler.jsonc`，不要在後台另外加；每次部署會以設定檔為準。
- 「清除全部數據」會同步到所有裝置。
- KV 免費方案每天 1,000 次寫入，日常使用綽綽有餘。
