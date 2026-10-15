// 密碼閘道：只轉發聊天相關的 API，其餘路徑（例如 /api/v1/models/load、/unload）一律不轉發。
// 必要的設定（用 wrangler secret 或 .dev.vars 設定，不要寫進程式碼）：
//   PASSWORD      使用者在頁面 Token 欄位輸入的密碼
//   ORIGIN_URL    Quick Tunnel 的網址，例如 https://xxxx.trycloudflare.com（每次開 tunnel 都會變）
//   ALLOWED_ORIGIN 允許呼叫的前端網址，例如 https://oid87.github.io

const ALLOWED_ROUTES = {
  "/v1/chat/completions": "POST",
  "/v1/models": "GET",
};
const MAX_BODY_BYTES = 1_000_000;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // 到期後直接拒絕，不需要你的電腦或 tunnel 還開著
    if (env.EXPIRES_AT && Date.now() >= Date.parse(env.EXPIRES_AT)) {
      return json({ error: "expired" }, 410, cors);
    }

    const url = new URL(request.url);
    const wantMethod = ALLOWED_ROUTES[url.pathname];
    if (!wantMethod) return json({ error: "not found" }, 404, cors);
    if (request.method !== wantMethod) return json({ error: "method not allowed" }, 405, cors);

    if (!env.PASSWORD || !env.ORIGIN_URL) {
      return json({ error: "worker not configured" }, 500, cors);
    }
    if (!(await passwordOk(request, env.PASSWORD))) {
      return json({ error: "unauthorized" }, 401, cors);
    }

    let body;
    if (wantMethod === "POST") {
      body = await request.text();
      if (body.length > MAX_BODY_BYTES) return json({ error: "payload too large" }, 413, cors);
    }

    const upstream = await fetch(env.ORIGIN_URL.replace(/\/+$/, "") + url.pathname, {
      method: wantMethod,
      headers: { "Content-Type": "application/json" },
      body,
    });

    // 串流回應直接透傳，保留 SSE 的逐字輸出
    const headers = new Headers(cors);
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");
    headers.set("Cache-Control", "no-cache");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "null",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

// 常數時間比較，避免從回應時間猜密碼
async function passwordOk(request, expected) {
  const auth = request.headers.get("Authorization") || "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const enc = new TextEncoder();
  const a = enc.encode(given);
  const b = enc.encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
