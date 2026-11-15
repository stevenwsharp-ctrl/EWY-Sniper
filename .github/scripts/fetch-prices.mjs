// EWY Sniper price fetcher. Runs in GitHub Actions (Node 20+).
// Gets prices from Yahoo Finance on the server (no CORS problem) and writes data.json.
// Each job updates data.json about every 60 seconds for ~5 minutes, every day (weekends too).
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const OUT = process.argv[2] || "data.json";
const LOOP_MS = Number(process.env.LOOP_MS || 285000);   // run time per job while a market is open
const STEP_MS = Number(process.env.STEP_MS || 60000);    // time between updates

// Symbols: every Korean ticker in index.html, plus market cards and EWY.
const html = readFileSync("index.html", "utf8");
const korean = [...new Set([...html.matchAll(/"(\d{6}\.K[SQ])"/g)].map(m => m[1]))];
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

async function snapshot() {
  const quotes = {};
  const errors = [];
  for (let i = 0; i < SYMBOLS.length; i += 6) {
    await Promise.all(SYMBOLS.slice(i, i + 6).map(async s => {
      try { quotes[s] = await chart(s); } catch (e) { errors.push(e.message); }
    }));
  }
  return { updated: new Date().toISOString(), quotes, errors };
}

function publish() {
  // Push data.json to the "data" branch (one commit, history replaced each time).
  if (!process.env.GITHUB_ACTIONS) return;
  execSync(`bash .github/scripts/publish.sh "${OUT}"`, { stdio: "inherit" });
}

const end = Date.now() + LOOP_MS;
let n = 0;
do {
  const t0 = Date.now();
  const snap = await snapshot();
  const ok = Object.keys(snap.quotes).length;
  console.log(`${snap.updated}: ${ok}/${SYMBOLS.length} quotes` + (snap.errors.length ? `; errors: ${snap.errors.slice(0, 5).join(" | ")}` : ""));
  if (ok > 0) {
    writeFileSync(OUT, JSON.stringify(snap));
    publish();
  } else if (n === 0) {
    process.exitCode = 1;
  }
  n++;
  const wait = STEP_MS - (Date.now() - t0);
  if (Date.now() + wait >= end) break;
  if (wait > 0) await sleep(wait);
} while (true);
