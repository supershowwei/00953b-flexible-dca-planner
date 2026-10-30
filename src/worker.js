// 00953B 參數流程圖：雲端同步服務
// 網頁（public/index.html）由 Cloudflare 直接當靜態檔提供；
// /api/state 負責讀寫 KV 裡的同步數據；
// /api/market 從玩股網日K API 算出今日判斷要用的行情數字。
//
// 需要的設定：
//   - KV 綁定 STATE：寫在 wrangler.jsonc
//
// 任何 20 字元以上的金鑰都能同步，每把金鑰各存一組數據（KV key 是金鑰的 SHA-256）。
// 舊版只有一組數據存在 'state'；若還留著 Secret SYNC_TOKEN，用那把金鑰同步時會沿用舊數據。

const LEGACY_KEY = 'state';
const MIN_TOKEN = 20;
const MAX_TOKEN = 200;

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

async function stateKey(token) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return 'state:' + [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleState(request, env) {
  if (!env.STATE) return json({ error: 'not configured', missing: ['STATE'] }, 500);

  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token.length < MIN_TOKEN || token.length > MAX_TOKEN) return json({ error: 'bad token', min: MIN_TOKEN, max: MAX_TOKEN }, 401);

  const key = await stateKey(token);
  const legacy = env.SYNC_TOKEN ? await sameToken(token, env.SYNC_TOKEN) : false;
  const load = async () => (await env.STATE.get(key, 'json')) || (legacy ? await env.STATE.get(LEGACY_KEY, 'json') : null);

  if (request.method === 'GET') {
    return json(await load());
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
    const cur = await load();
    const curVersion = cur ? cur.version : 0;
    // 版本不符代表另一台裝置先存過：不覆蓋，把雲端上的最新數據回傳
    if (body.baseVersion !== curVersion) return json({ conflict: true, state: cur }, 409);
    const next = { version: curVersion + 1, savedAt: new Date().toISOString(), params: body.params, day: body.day };
    await env.STATE.put(key, JSON.stringify(next));
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

const RECENT_DAYS = 45;
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
  // 最近的每日收盤與 MA60，網頁用來查除息日的數據與除息後第幾個交易日
  const recent = [];
  for (let i = Math.max(59, daily.length - RECENT_DAYS); i < daily.length; i++) {
    recent.push({ date: daily[i].tradeDate, close: daily[i].close, ma60: round(mean(closes.slice(i - 59, i + 1))) });
  }

  return json({
    date: last.tradeDate,
    retroDate: retroLast.tradeDate,
    close: last.close,
    ma5: round(mean(closes.slice(-5))),
    ma60: round(mean(closes.slice(-60))),
    bbLower: round(m20 - 2 * sd20),
    // 網頁用來算加碼條件的 BB 下緣（倍數可調）
    bbMid: round(m20),
    bbSd: round(sd20, 6),
    recent,
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
