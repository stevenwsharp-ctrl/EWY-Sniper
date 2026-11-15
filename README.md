# EWY-Sniper

Live tracker for the stocks in the iShares MSCI South Korea ETF (EWY).

**Open the site:** https://stevenwsharp-ctrl.github.io/EWY-Sniper/

## What it shows

- The top 22 EWY stocks (about 82% of the fund), each with its **% of EWY** weight.
- Live price, today's % change, and the impact of each stock on EWY.
- EWY price (with extended hours), the Korea basket move in USD, KOSPI, USD/KRW, and MU.
- Top lifts and top drags on EWY.
- KRX and US market status. Auto refresh every 20 seconds.

## Files

- `index.html` — the site.
- `worker.js` — optional Cloudflare Worker data proxy. Use it if the free proxies are busy. Put its URL in the page **Settings**.

## Update the weights

Open **Settings** on the page. Paste one stock per line: `ticker, name, weight`. Click **Save**.

---

Prices come from Yahoo Finance and can have a short delay. For information only. Not financial advice.
