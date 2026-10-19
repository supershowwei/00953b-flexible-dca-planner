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
3. **設定同步金鑰**：部署完成後，到這個 Worker → Settings → Variables and Secrets → Add，
   類型選 **Secret**，名稱 `SYNC_TOKEN`，值填一串 20 字元以上的隨機字串。
4. **開始使用**：打開 Worker 的網址，在左邊「雲端同步」填入同一把金鑰，按「儲存金鑰並同步」。
   其他裝置打開同一個網址、填同一把金鑰即可。

## 之後更新網頁

直接修改 `public/index.html` 後 push，Cloudflare 會自動重新部署。KV 裡的數據和 `SYNC_TOKEN` 都不受影響。

## 注意

- KV 綁定請寫在 `wrangler.jsonc`，不要在後台另外加；每次部署會以設定檔為準。
- 「清除全部數據」會同步到所有裝置。
- KV 免費方案每天 1,000 次寫入，日常使用綽綽有餘。
