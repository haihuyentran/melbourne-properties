#!/usr/bin/env node
/**
 * Fill missing median prices from REIV suburb pages.
 * REIV shows Houses by default; the same HTML does not contain the Units-tab value
 * (that is loaded when you click "Units"). So this script gets MEDIAN HOUSE PRICE
 * only; median unit may be wrong or from a different section. For both House and
 * Unit medians, use: node scripts/fetch-reiv-prices-with-units.js (requires Puppeteer).
 * Usage: node scripts/fetch-reiv-prices.js [--limit N]
 * Rate limit: 2 sec between requests (REIV-friendly).
 */

const fs = require('fs');
const path = require('path');

const suburbsPath = path.join(__dirname, '..', 'data', 'suburbs.json');
const REIV_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parsePriceFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.replace(/,/g, '').trim();
  const milMatch = cleaned.match(/\$?\s*(\d(?:\.\d+)?)\s*mi?l/i);
  if (milMatch) return Math.round(parseFloat(milMatch[1]) * 1e6);
  const kMatch = cleaned.match(/\$?\s*(\d+(?:\.\d+)?)\s*k/i);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  const numMatch = cleaned.match(/\$?\s*([\d,]+)/);
  if (numMatch) return parseInt(numMatch[1].replace(/,/g, ''), 10);
  return null;
}

async function fetchREIVPrices(slug) {
  const url = `https://reiv.com.au/market-insights/suburb/${encodeURIComponent(slug)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'MelbournePropertyFinder/1.0 (data sync)' }
  });
  if (!res.ok) return null;
  const html = await res.text();

  // Default REIV view = Houses tab. So this parse gives MEDIAN HOUSE PRICE only.
  const result = { medianPrice: null, medianPriceUnit: null, annualChange: null };
  const afterMedian = html.indexOf('Median sale price') >= 0 ? html.split('Median sale price').pop() : html;
  const priceBlock = (afterMedian.match(/\$[\d,.]+\s*[mk]?i?l?/i) || [])[0] || afterMedian.match(/\$[\d,]+/)?.[0];
  if (priceBlock) {
    const mil = priceBlock.match(/\$?\s*([\d,.]+)\s*mi?l/i);
    const k = priceBlock.match(/\$?\s*([\d,.]+)\s*k/i);
    const full = priceBlock.match(/\$?\s*([\d,]+)/);
    if (mil) result.medianPrice = Math.round(parseFloat(mil[1].replace(/,/g, '')) * 1e6);
    else if (k) result.medianPrice = Math.round(parseFloat(k[1].replace(/,/g, '')) * 1000);
    else if (full) result.medianPrice = parseInt(full[1].replace(/,/g, ''), 10);
  }
  // Unit median is only visible after clicking "Units" tab (client-side). We do not parse it here.
  result.medianPriceUnit = null;
  const qChangeMatch = html.match(/Quarterly\s*price\s*change[\s\S]{0,200}?([-]?\d+(?:\.\d+)?)\s*%/i);
  if (qChangeMatch) result.annualChange = parseFloat(qChangeMatch[1]);
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  let limit = null;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx >= 0 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1], 10);
    if (isNaN(limit) || limit < 1) limit = null;
  }

  const suburbs = JSON.parse(fs.readFileSync(suburbsPath, 'utf8'));
  const missing = Object.entries(suburbs.suburbs)
    .filter(([, s]) => s.reivSlug && s.medianPrice == null)
    .map(([name]) => name);

  const total = limit != null ? Math.min(limit, missing.length) : missing.length;
  console.log(`Suburbs missing median price: ${missing.length}`);
  console.log(`Will fetch from REIV this run: ${total}`);
  if (total === 0) {
    console.log('Nothing to do.');
    return;
  }

  let updated = 0;
  for (let i = 0; i < total; i++) {
    const name = missing[i];
    const slug = suburbs.suburbs[name].reivSlug;
    try {
      const data = await fetchREIVPrices(slug);
      if (data && (data.medianPrice != null || data.medianPriceUnit != null)) {
        const sub = suburbs.suburbs[name];
        if (data.medianPrice != null) {
          sub.medianPrice = data.medianPrice;
          if (sub.priceHistory && typeof sub.priceHistory === 'object') sub.priceHistory['2025'] = data.medianPrice;
        }
        if (data.medianPriceUnit != null) sub.medianPriceUnit = data.medianPriceUnit;
        if (data.annualChange != null) sub.annualChange = data.annualChange;
        updated++;
        console.log(`[${i + 1}/${total}] ${name}: house $${(sub.medianPrice || 0) / 1000}k, unit ${sub.medianPriceUnit != null ? '$' + (sub.medianPriceUnit / 1000) + 'k' : '-'}`);
      } else {
        console.log(`[${i + 1}/${total}] ${name}: no data`);
      }
    } catch (e) {
      console.error(`[${name}]`, e.message);
    }
    if ((i + 1) % 20 === 0) {
      fs.writeFileSync(suburbsPath, JSON.stringify(suburbs, null, 2) + '\n', 'utf8');
      console.log(`  ... saved (${updated} updated so far)`);
    }
    if (i < total - 1) await sleep(REIV_DELAY_MS);
  }

  suburbs.metadata.notes = (suburbs.metadata.notes || '').replace(/\s*Prices from REIV[^.]*\.?/g, '').trim();
  suburbs.metadata.notes = (suburbs.metadata.notes || '') + ' Prices from REIV where VPSR not available.';
  fs.writeFileSync(suburbsPath, JSON.stringify(suburbs, null, 2) + '\n', 'utf8');
  console.log(`Done. Updated ${updated} suburbs from REIV.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
