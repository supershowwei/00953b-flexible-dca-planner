// 00953B 參數流程圖：雲端同步服務
// 網頁（public/index.html）由 Cloudflare 直接當靜態檔提供；
// 只有 /api/state 這個路徑會進到這支程式，負責讀寫 KV 裡的同步數據。
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
  if (!env.STATE || !env.SYNC_TOKEN) return json({ error: 'not configured' }, 500);

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/state') return handleState(request, env);
    return env.ASSETS.fetch(request);
  },
};
