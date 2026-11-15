# EWY-Sniper

Live tracker for the stocks in the iShares MSCI South Korea ETF (EWY).

**Open the site:** https://stevenwsharp-ctrl.github.io/EWY-Sniper/

## What it shows

- The top 22 EWY stocks (about 82% of the fund), each with its **% of EWY** weight.
- Live price, today's % change, and the impact of each stock on EWY.
- News for each stock (Google News and Yahoo Finance), with major stories marked. Click 🔔 for a sound alert and pop-up on new major stories.
- EWY price (with extended hours), the Korea basket move in USD, KOSPI, USD/KRW, and MU.
- Top lifts and top drags on EWY.
- KRX and US market status. Auto refresh every 30 seconds.

## Files

- `index.html` — the site.
- `.github/workflows/prices.yml` — GitHub Action. It gets the prices from Yahoo Finance about every 60 seconds, every day and saves them as `data.json` on the `data` branch. The page reads that file. No proxy is necessary.
- `worker.js` — optional Cloudflare Worker data proxy. Not necessary. Use it only if you want second-by-second prices. Put its URL in the page **Settings**.

## Update the weights

Open **Settings** on the page. Paste one stock per line: `ticker, name, weight`. Click **Save**.

---

Prices come from Yahoo Finance and can have a short delay. For information only. Not financial advice.
