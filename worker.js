// EWY Sniper data proxy (optional). Deploy as a Cloudflare Worker.
// Then put this in EWY Sniper Settings: https://YOUR-WORKER.workers.dev/?url={url}
export default {
  async fetch(request) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const target = new URL(request.url).searchParams.get("url");
    if (!target) return new Response("Missing url", { status: 400, headers: cors });

    let u;
    try { u = new URL(target); } catch (e) { return new Response("Bad url", { status: 400, headers: cors }); }
    if (!/(^|\.)finance\.yahoo\.com$/.test(u.hostname)) {
      return new Response("Host not allowed", { status: 403, headers: cors });
    }

    const r = await fetch(u.toString(), { headers: { "User-Agent": "Mozilla/5.0" } });
    return new Response(r.body, {
      status: r.status,
      headers: {
        ...cors,
        "Content-Type": r.headers.get("Content-Type") || "application/json",
        "Cache-Control": "max-age=5"
      }
    });
  }
};
