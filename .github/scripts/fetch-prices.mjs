// EWY Sniper price fetcher. Runs in GitHub Actions (Node 20+).
// Gets prices from Yahoo Finance on the server (no CORS problem) and writes data.json.
// Each job runs ~5 h 40 min. It updates every 15 s while KRX or US markets are live, else every 60 s.
// Each update is saved as out/s/<slot>.json (a new file name per 15 s slot, so the raw file cache cannot
// give old data) and as out/data.json. The workflow starts the next job at the end.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { getNews } from "./news.mjs";

const OUT_DIR = process.argv[2] || "out";
const LOOP_MS = Number(process.env.LOOP_MS || 340 * 60000);  // run time per job
const LIVE_STEP_MS = 15000;                                  // time between updates while a market is live
const IDLE_STEP_MS = 60000;                                  // time between updates at other times
const SLOT_MS = 15000;                                       // one file name per 15 s
const KEEP_SLOTS = 40;
mkdirSync(OUT_DIR + "/s", { recursive: true });

function minutesIn(tz) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const g = t => (p.find(x => x.type === t) || {}).value;
  return { wd: g("weekday"), m: (parseInt(g("hour"), 10) % 24) * 60 + parseInt(g("minute"), 10) };
}
function marketLive() {
  const k = minutesIn("Asia/Seoul"), u = minutesIn("America/New_York");
  const krx = !["Sat", "Sun"].includes(k.wd) && k.m >= 480 && k.m < 1200;   // NXT pre 08:00 to NXT after 20:00 KST
  const us = !["Sat", "Sun"].includes(u.wd) && u.m >= 240 && u.m < 1200;    // US pre-market 04:00 to after-hours 20:00 ET
  return krx || us;
}

// Symbols: every Korean ticker in index.html, plus market cards and EWY.
const html = readFileSync("index.html", "utf8");
const korean = [...new Set([...html.matchAll(/"(\d{6}\.K[SQ])"/g)].map(m => m[1]))];
const HOLDINGS = [...html.matchAll(/\["(\d{6}\.K[SQ])","([^"]+)",([\d.]+)\]/g)].map(m => [m[1], m[2], Number(m[3])]);
const MARKET = ["^KS11", "KRW=X", "MU"];
const SYMBOLS = [...korean, ...MARKET, "EWY"];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function chart(sym) {
  const prePost = sym === "EWY";
  let lastErr;
  for (const host of HOSTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1m&includePrePost=${prePost}`;
        const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        const res = j?.chart?.result?.[0];
        if (!res) throw new Error("no result");
        const m = res.meta || {};
        const closes = res.indicators?.quote?.[0]?.close || [];
        let last = null;
        for (let i = closes.length - 1; i >= 0; i--) if (closes[i] != null) { last = closes[i]; break; }
        const price = m.regularMarketPrice ?? last;
        const prev = m.previousClose ?? m.chartPreviousClose ?? null;
        return {
          price,
          prev,
          chg: price != null && prev ? (price / prev - 1) * 100 : null,
          time: m.regularMarketTime ?? null,
          extPrice: prePost ? last : undefined
        };
      } catch (e) {
        lastErr = e;
        await sleep(400 * (attempt + 1));
      }
    }
  }
  throw new Error(`${sym}: ${lastErr?.message}`);
}

// Nextrade (NXT) pre-market (08:00–08:50 KST) and after-market (15:30–20:00 KST) from Naver Finance.
const num = v => { if (v == null) return null; const n = Number(String(v).replace(/,/g, "")); return isFinite(n) && n > 0 ? n : null; };
// Naver gives the real-time KRX price in the regular session (Yahoo's KRX prices are ~20 min late),
// and the Nextrade pre-market / after-market price.
const lastRegular = {};   // last real-time KRX price seen in this run, by ticker
async function naver(sym) {
  const code = sym.slice(0, 6);
  const r = await fetch(`https://polling.finance.naver.com/api/realtime/domestic/stock/${code}`, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!r.ok) throw new Error(`naver ${code} HTTP ${r.status}`);
  const d = (await r.json())?.datas?.[0];
  if (!d) throw new Error(`naver ${code} no data`);
  const o = d.overMarketPriceInfo || {};
  const status = String(o.overMarketStatus || "").toUpperCase();       // PREOPEN, OPEN, CLOSE
  const st = String(o.tradingSessionType || "").toUpperCase();          // PRE_MARKET, REGULAR_MARKET, AFTER_MARKET
  const ms = String(d.marketSessionType || "");                         // preMarket, regularMarket, afterMarket

  let regular = null;
  if (/regular/i.test(ms) && String(d.marketStatus).toUpperCase() === "OPEN") {
    const price = num(d.closePriceRaw ?? d.closePrice);
    const diff = Number(String(d.compareToPreviousClosePriceRaw ?? "").replace(/,/g, ""));
    if (price && isFinite(diff)) {
      regular = { price, prev: price - diff, chg: (diff / (price - diff)) * 100, time: d.localTradedAt, live: true };
      lastRegular[sym] = { ...regular, live: false, day: String(d.localTradedAt || "").slice(0, 10) };
    }
  }

  let ext = null;
  if ((st === "PRE_MARKET" || st === "AFTER_MARKET") && num(o.overPrice) && status !== "PREOPEN") {
    ext = { price: num(o.overPrice), session: st === "PRE_MARKET" ? "pre" : "after", live: status === "OPEN", time: o.localTradedAt };
  } else if (!regular && /after/i.test(ms) && num(d.closePriceRaw ?? d.closePrice)) {
    // Before the next pre-market opens: the last after-market trade.
    ext = { price: num(d.closePriceRaw ?? d.closePrice), session: "after", live: false, time: d.localTradedAt };
  }
  return { regular, ext };
}

async function snapshot() {
  const quotes = {};
  const errors = [];
  for (let i = 0; i < SYMBOLS.length; i += 6) {
    await Promise.all(SYMBOLS.slice(i, i + 6).map(async s => {
      try { quotes[s] = await chart(s); } catch (e) { errors.push(e.message); }
    }));
  }
  for (let i = 0; i < korean.length; i += 6) {
    await Promise.all(korean.slice(i, i + 6).map(async s => {
      try {
        const { regular, ext } = await naver(s);
        const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
        if (regular) quotes[s] = { ...(quotes[s] || {}), ...regular, src: "naver" };
        else if (lastRegular[s] && lastRegular[s].day === today && quotes[s]) {
          // KRX just closed and Yahoo may still be late: use the last real-time KRX price.
          const y = quotes[s], l = lastRegular[s];
          if (!y.time || y.time * 1000 < Date.parse(l.time)) quotes[s] = { ...y, price: l.price, prev: l.prev, chg: l.chg, live: false };
        }
        const q = quotes[s];
        if (q) q.krxLive = !!regular;
        // The extended price is compared with the last KRX close.
        if (q && ext && q.price) q.ext = { ...ext, ref: q.price, chg: (ext.price / q.price - 1) * 100 };
        else if (q) delete q.ext;
      } catch (e) { errors.push(e.message); }
    }));
  }
  return { updated: new Date().toISOString(), quotes, errors };
}

function save(snap) {
  const body = JSON.stringify(snap);
  writeFileSync(OUT_DIR + "/data.json", body);
  writeFileSync(`${OUT_DIR}/s/${Math.floor(Date.now() / SLOT_MS)}.json`, body);
  const files = readdirSync(OUT_DIR + "/s").sort((a, b) => parseInt(b) - parseInt(a));
  files.slice(KEEP_SLOTS).forEach(f => rmSync(`${OUT_DIR}/s/${f}`));
}
function publish() {
  // Push the out folder to the "data" branch (one commit, history replaced each time).
  if (!process.env.GITHUB_ACTIONS) return;
  try { execSync(`bash .github/scripts/publish.sh "${OUT_DIR}"`, { stdio: "inherit" }); }
  catch (e) { console.log("push failed: " + e.message); }
}

const NEWS_EVERY_MS = 55000;
let news = { items: [], errors: [] }, newsAt = 0, newsRound = 0;
// Start with the headlines saved by the last run.
try {
  const r = await fetch(`https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY || "stevenwsharp-ctrl/EWY-Sniper"}/data/data.json?t=${Date.now()}`);
  if (r.ok) { const j = await r.json(); news.items = Array.isArray(j.news) ? j.news : []; }
} catch (e) {}
console.log(`news from last run: ${news.items.length}`);
async function refreshNews() {
  try {
    const got = await getNews(HOLDINGS, news.items, newsRound++);
    news = got; newsAt = Date.now();
  } catch (e) { news.errors = [e.message]; }
  console.log(`news: ${news.items.length} items, ${news.items.filter(x => x.major).length} major` + (news.errors.length ? `; errors: ${news.errors.slice(0, 3).join(" | ")}` : ""));
}

const end = Date.now() + LOOP_MS;
let n = 0;
do {
  const t0 = Date.now();
  if (Date.now() - newsAt > NEWS_EVERY_MS) await refreshNews();
  const snap = await snapshot();
  snap.news = news.items;
  snap.newsUpdated = newsAt ? new Date(newsAt).toISOString() : null;
  const ok = Object.keys(snap.quotes).length;
  console.log(`${snap.updated}: ${ok}/${SYMBOLS.length} quotes` + (snap.errors.length ? `; errors: ${snap.errors.slice(0, 5).join(" | ")}` : ""));
  if (ok > 0) {
    save(snap);
    publish();
  }
  n++;
  const wait = (marketLive() ? LIVE_STEP_MS : IDLE_STEP_MS) - (Date.now() - t0);
  if (Date.now() + wait >= end) break;
  if (wait > 0) await sleep(wait);
} while (true);
