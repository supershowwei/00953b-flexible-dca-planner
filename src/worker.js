// 00953B 參數流程圖：雲端同步服務
// 網頁（public/index.html）由 Cloudflare 直接當靜態檔提供；
// /api/state 負責讀寫 KV 裡的同步數據；
// /api/market 從玩股網日K API 算出今日判斷要用的行情數字。
//
// 需要的設定：
//   - KV 綁定 STATE：寫在 wrangler.jsonc
//   - Secret SYNC_TOKEN：在 Cloudflare 後台 Worker → Settings → Variables and Secrets 設定

const KEY = 'state';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function sameToken(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

async function handleState(request, env) {
  const missing = [];
  if (!env.STATE) missing.push('STATE');
  if (!env.SYNC_TOKEN) missing.push('SYNC_TOKEN');
  if (missing.length) return json({ error: 'not configured', missing }, 500);

  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !(await sameToken(token, env.SYNC_TOKEN))) return json({ error: 'unauthorized' }, 401);

  if (request.method === 'GET') {
    return json(await env.STATE.get(KEY, 'json'));
  }

  if (request.method === 'PUT') {
    const text = await request.text();
    if (text.length > 200000) return json({ error: 'too large' }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
    if (!body || typeof body !== 'object' || typeof body.baseVersion !== 'number'
        || !body.params || typeof body.params !== 'object'
        || !body.day || typeof body.day !== 'object') {
      return json({ error: 'bad data' }, 400);
    }
    const cur = await env.STATE.get(KEY, 'json');
    const curVersion = cur ? cur.version : 0;
    // 版本不符代表另一台裝置先存過：不覆蓋，把雲端上的最新數據回傳
    if (body.baseVersion !== curVersion) return json({ conflict: true, state: cur }, 409);
    const next = { version: curVersion + 1, savedAt: new Date().toISOString(), params: body.params, day: body.day };
    await env.STATE.put(KEY, JSON.stringify(next));
    return json({ version: next.version, savedAt: next.savedAt });
  }

  return json({ error: 'method not allowed' }, 405);
}

const CANDLES_URL = 'https://www.wantgoo.com/investrue/00953b/all-daily-candles';
const RETRO_CANDLES_URL = 'https://www.wantgoo.com/investrue/00953b/all-retro-daily-candles';

async function fetchCandles(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} 回應 ${r.status}`);
  const rows = await r.json();
  if (!Array.isArray(rows) || !rows.length) throw new Error(`${url} 沒有數據`);
  return rows
    .filter(x => x && typeof x.tradeDate === 'string' && Number.isFinite(x.close))
    .sort((a, b) => (a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : 0));
}

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

async function handleMarket() {
  let daily, retro;
  try {
    [daily, retro] = await Promise.all([fetchCandles(CANDLES_URL), fetchCandles(RETRO_CANDLES_URL)]);
  } catch (e) {
    return json({ error: 'upstream', message: String(e.message || e) }, 502);
  }
  if (daily.length < 60 || retro.length < 20) return json({ error: 'not enough data' }, 502);

  const last = daily[daily.length - 1];
  const retroLast = retro[retro.length - 1];
  const closes = daily.map(x => x.close);
  // 布林通道 20 日、2 倍標準差（母體標準差），用還原收盤計算
  const r20 = retro.slice(-20).map(x => x.close);
  const m20 = mean(r20);
  const sd20 = Math.sqrt(mean(r20.map(x => (x - m20) ** 2)));
  const month = last.tradeDate.slice(0, 7);
  const monthFirst = daily.find(x => x.tradeDate.startsWith(month));

  return json({
    date: last.tradeDate,
    retroDate: retroLast.tradeDate,
    close: last.close,
    ma5: round(mean(closes.slice(-5))),
    ma60: round(mean(closes.slice(-60))),
    bbLower: round(m20 - 2 * sd20),
    monthOpenDate: monthFirst.tradeDate,
    monthOpenClose: monthFirst.close,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/state') return handleState(request, env);
    if (url.pathname === '/api/market') return handleMarket();
    return env.ASSETS.fetch(request);
  },
};
