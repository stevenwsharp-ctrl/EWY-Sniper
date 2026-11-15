// EWY Sniper news. Gets headlines from Google News RSS and Yahoo Finance search,
// links each headline to the EWY stocks it names, and marks major stories.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_AGE_H = 48;
const MAX_ITEMS = 80;

// Extra names that headlines use. Key = ticker.
const ALIASES = {
  "000660.KS": ["SK hynix", "Hynix"],
  "005930.KS": ["Samsung Electronics", "Samsung Elec"],
  "009150.KS": ["Samsung Electro-Mechanics", "Samsung Electro Mechanics", "SEMCO"],
  "402340.KS": ["SK Square"],
  "005380.KS": ["Hyundai Motor", "Hyundai Motors"],
  "105560.KS": ["KB Financial"],
  "012330.KS": ["Hyundai Mobis"],
  "034020.KS": ["Doosan Enerbility"],
  "006400.KS": ["Samsung SDI"],
  "012450.KS": ["Hanwha Aerospace"],
  "000270.KS": ["Kia"],
  "055550.KS": ["Shinhan"],
  "028260.KS": ["Samsung C&T"],
  "066570.KS": ["LG Electronics"],
  "032830.KS": ["Samsung Life"],
  "035420.KS": ["Naver"],
  "086790.KS": ["Hana Financial"],
  "005490.KS": ["POSCO"],
  "068270.KS": ["Celltrion"],
  "034730.KS": ["SK Inc"],
  "329180.KS": ["HD Hyundai Heavy"],
  "267260.KS": ["HD Hyundai Electric"]
};

// Words that make a story major. Score 2 = strong, 1 = medium.
const STRONG = [
  "plunge", "plunges", "plummet", "soar", "soars", "surge", "surges", "crash", "tumble", "tumbles", "skyrocket",
  "halt", "halted", "suspend", "suspended", "acquire", "acquisition", "merger", "takeover", "buyout", "bankrupt",
  "fraud", "probe", "raid", "indict", "arrest", "sanction", "export control", "export ban", "ban ", "tariff",
  "recall", "fire at", "explosion", "strike", "profit warning", "guidance", "record profit", "record high",
  "record low", "downgrade", "upgrade", "earnings", "operating profit", "quarterly profit", "net loss",
  "martial law", "impeach", "rate cut", "rate hike", "bank of korea", "msci", "short selling", "buyback",
  "dividend", "spin-off", "spinoff", "ipo", "delist", "lawsuit", "fine", "antitrust"
];
const MEDIUM = [
  "hbm", "nvidia", "dram", "nand", "memory chip", "chip price", "foundry", "ai chip", "contract", "deal",
  "order", "shipbuilding", "defense", "won ", "kospi", "outlook", "forecast", "beats", "misses", "target price",
  "foreign investors", "sell-off", "selloff", "rally", "battery", "ev ", "semiconductor"
];

function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "").trim();
}
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ""; };

async function get(url, type) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": type } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url.slice(0, 60)}`);
  return type.includes("json") ? r.json() : r.text();
}

async function googleNews(query) {
  const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(query + " when:2d") + "&hl=en-US&gl=US&ceid=US:en";
  const xml = await get(url, "application/rss+xml");
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const it = m[1];
    let title = tag(it, "title");
    const source = tag(it, "source");
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
    return { title, link: tag(it, "link"), source, time: Date.parse(tag(it, "pubDate")) || null };
  });
}

async function yahooNews(sym) {
  const url = "https://query1.finance.yahoo.com/v1/finance/search?q=" + encodeURIComponent(sym) + "&quotesCount=0&newsCount=10";
  const j = await get(url, "application/json");
  return (j.news || []).map(n => ({
    title: n.title, link: n.link, source: n.publisher, time: n.providerPublishTime ? n.providerPublishTime * 1000 : null, hint: sym
  }));
}

function matchTickers(title, holdings) {
  const t = " " + title.toLowerCase() + " ";
  const out = [];
  for (const [sym, name] of holdings) {
    const names = [name, ...(ALIASES[sym] || [])];
    if (names.some(n => {
      const k = n.toLowerCase();
      // Whole-word match, so "Kia" does not match "Asia".
      return new RegExp(`(^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(t);
    })) out.push(sym);
  }
  // A plain "Samsung" headline with no other Samsung company = Samsung Electronics.
  if (!out.some(s => ["005930.KS", "009150.KS", "006400.KS", "028260.KS", "032830.KS"].includes(s)) && /(^|[^a-z])samsung([^a-z]|$)/.test(t)) out.push("005930.KS");
  return out;
}

function score(title, tickers, weights) {
  const t = " " + title.toLowerCase() + " ";
  let s = 0;
  const hits = [];
  const has = w => new RegExp(`(^|[^a-z])${w.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(t);
  for (const w of STRONG) if (has(w)) { s += 2; hits.push(w.trim()); }
  for (const w of MEDIUM) if (has(w)) { s += 1; hits.push(w.trim()); }
  const topW = Math.max(0, ...tickers.map(x => weights[x] || 0));
  if (topW >= 10) s += 2; else if (topW >= 3) s += 1;
  if (tickers.length >= 2) s += 1;
  if (/%/.test(t) && /\d/.test(t)) s += 1;  // a number with % (for example "shares fall 8%")
  return { score: s, hits: [...new Set(hits)].slice(0, 4) };
}

function norm(title) { return title.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 90); }

export async function getNews(holdings) {
  const weights = Object.fromEntries(holdings.map(h => [h[0], h[2]]));
  const names = holdings.map(h => h[1]);
  const queries = [];
  // Big holdings get their own search. Smaller ones are grouped (fewer requests).
  holdings.slice(0, 6).forEach(h => queries.push(`"${h[1]}"`));
  for (let i = 6; i < names.length; i += 5) queries.push(names.slice(i, i + 5).map(n => `"${n}"`).join(" OR "));
  queries.push(`KOSPI OR "Korean stocks" OR "EWY"`);

  const raw = [];
  const errors = [];
  await Promise.all(queries.map(async q => { try { raw.push(...await googleNews(q)); } catch (e) { errors.push("google: " + e.message); } }));
  await Promise.all(holdings.slice(0, 5).map(async h => { try { raw.push(...await yahooNews(h[0])); } catch (e) { errors.push("yahoo: " + e.message); } }));

  const now = Date.now();
  const byKey = new Map();
  for (const it of raw) {
    if (!it.title || !it.link || !it.time || now - it.time > MAX_AGE_H * 3600e3) continue;
    let tickers = matchTickers(it.title, holdings);
    if (!tickers.length && it.hint) tickers = [it.hint];
    const isMarket = !tickers.length && /kospi|korea|won|ewy/i.test(it.title);
    if (!tickers.length && !isMarket) continue;
    const k = norm(it.title);
    const prev = byKey.get(k);
    if (prev) { prev.tickers = [...new Set([...prev.tickers, ...tickers])]; if (it.time < prev.time) prev.time = it.time; continue; }
    byKey.set(k, { id: k.slice(0, 60), title: it.title, link: it.link, source: it.source || "", time: it.time, tickers, market: isMarket });
  }
  const items = [...byKey.values()].map(n => {
    const sc = score(n.title, n.tickers, weights);
    return { ...n, score: sc.score, hits: sc.hits, major: sc.score >= 4 };
  });
  items.sort((a, b) => b.time - a.time);
  return { items: items.slice(0, MAX_ITEMS), errors };
}
