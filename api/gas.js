const GAS_ENDPOINT =
  process.env.GAS_ENDPOINT ||
  "https://script.google.com/macros/s/AKfycbwHCmikLDfBN25bLcEkaLP6RlGyuf7Z6B64hGB0BJGcLQjxwiysATZ6qSdAZNl5h0m1RQ/exec";

function collectParams(req) {
  const params = new URLSearchParams();
  const sources = [];
  if (req.query && typeof req.query === "object") sources.push(req.query);
  if (req.method === "POST" && req.body && typeof req.body === "object") sources.push(req.body);

  sources.forEach(source => {
    Object.keys(source).forEach(key => {
      if (key === "callback") return;
      const value = source[key];
      if (value == null) return;
      params.set(key, Array.isArray(value) ? String(value[0]) : String(value));
    });
  });
  return params;
}

function toJsonBody(text) {
  const body = String(text || "").trim();
  if (!body) return '{"ok":false,"message":"空の応答です。"}';
  if (body.startsWith("{") || body.startsWith("[")) return body;
  const matched = body.match(/^[a-zA-Z_$][\w$]*\(([\s\S]*)\);?\s*$/);
  if (matched) return matched[1];
  return JSON.stringify({ ok: false, message: "予期しない応答です。" });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    const params = collectParams(req);
    const url = `${GAS_ENDPOINT}?${params.toString()}`;
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "joyfit-9th-event-proxy/1.0",
      },
    });
    const text = await response.text();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).send(toJsonBody(text));
  } catch (error) {
    res.status(502).json({
      ok: false,
      message: "通信に失敗しました。もう一度お試しください。",
    });
  }
};
