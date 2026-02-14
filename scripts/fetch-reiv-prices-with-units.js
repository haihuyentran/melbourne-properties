#!/usr/bin/env node
/**
 * Fetch REIV median HOUSE and UNIT prices by loading each suburb page and
 * reading the Houses view (default) then clicking the Units tab and reading that view.
 * Requires: npm install puppeteer
 * Usage: node scripts/fetch-reiv-prices-with-units.js [--limit N]
 */

const fs = require('fs');
const path = require('path');

const suburbsPath = path.join(__dirname, '..', 'data', 'suburbs.json');
const REIV_DELAY_MS = 2500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parsePriceFromDisplay(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.replace(/,/g, '').trim();
  if (t === '-' || t === '') return null;
  const mil = t.match(/(\d(?:\.\d+)?)\s*mi?l/i);
  const k = t.match(/(\d+(?:\.\d+)?)\s*k/i);
  const num = t.match(/([\d,]+)/);
  if (mil) return Math.round(parseFloat(mil[1]) * 1e6);
  if (k) return Math.round(parseFloat(k[1]) * 1000);
  if (num) return parseInt(num[1].replace(/,/g, ''), 10);
  return null;
}

async function fetchREIVHouseAndUnitWithPuppeteer(page, slug) {
  const url = `https://reiv.com.au/market-insights/suburb/${encodeURIComponent(slug)}`;
  const result = { medianPrice: null, medianPriceUnit: null, annualChange: null };

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(2000);

    // Helper: find "Median sale price" (or similar) label and return the value from the next sibling/card
    const getMedianFromPage = () => page.evaluate(() => {
      const all = document.body.innerText || '';
      const match = all.match(/Median\s*sale\s*price[\s\S]*?\$?\s*([\d,.]+\s*[mk]?i?l?|[\d,]+)/i);
      if (match) return match[1].trim();
      const headings = Array.from(document.querySelectorAll('h6, [class*="label"], [class*="title"]'));
      for (const h of headings) {
        if (/median\s*sale\s*price/i.test(h.textContent || '')) {
          let next = h.nextElementSibling;
          for (let i = 0; i < 3 && next; i++) {
            const t = (next.textContent || '').trim();
            if (/^\$?[\d,.]+\s*[mk]?i?l?$|^\$?[\d,]+$/i.test(t)) return t.replace(/\$/g, '').trim();
            next = next.nextElementSibling;
          }
          break;
        }
      }
      return null;
    });

    const getQuarterlyChange = () => page.evaluate(() => {
      const all = document.body.innerText || '';
      const m = all.match(/Quarterly\s*price\s*change[\s\S]*?([-]?\d+(?:\.\d+)?)\s*%/i);
      return m ? parseFloat(m[1]) : null;
    });

    // Default view = Houses
    const housePriceText = await getMedianFromPage();
    result.medianPrice = parsePriceFromDisplay(housePriceText || '');
    result.annualChange = await getQuarterlyChange();

    // Click "Units" tab then read median (same card shows unit median)
    const clicked = await page.evaluate(() => {
      const nodes = document.querySelectorAll('button, a, [role="tab"], [class*="tab"]');
      for (const n of nodes) {
        const t = (n.textContent || '').trim();
        if (/^Units?$/i.test(t)) {
          n.click();
          return true;
        }
      }
      return false;
    });
    if (clicked) {
      await sleep(1500);
      const unitPriceText = await getMedianFromPage();
      result.medianPriceUnit = parsePriceFromDisplay(unitPriceText || '');
    }
  } catch (e) {
    result._error = e.message;
  }
  return result;
}

async function main() {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    console.error('Install Puppeteer first: npm install puppeteer');
    process.exit(1);
  }

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
  console.log('REIV: House = default view, Unit = after clicking Units tab');
  console.log(`Suburbs missing median price: ${missing.length}`);
  console.log(`Will fetch this run: ${total}`);
  if (total === 0) {
    console.log('Nothing to do.');
    return;
  }

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('MelbournePropertyFinder/1.0 (data sync)');
  await page.setViewport({ width: 1280, height: 800 });

  let updated = 0;
  for (let i = 0; i < total; i++) {
    const name = missing[i];
    const slug = suburbs.suburbs[name].reivSlug;
    const data = await fetchREIVHouseAndUnitWithPuppeteer(page, slug);
    if (data._error) {
      console.log(`[${i + 1}/${total}] ${name}: error ${data._error}`);
    } else if (data.medianPrice != null || data.medianPriceUnit != null) {
      const sub = suburbs.suburbs[name];
      if (data.medianPrice != null) {
        sub.medianPrice = data.medianPrice;
        if (sub.priceHistory && typeof sub.priceHistory === 'object') sub.priceHistory['2025'] = data.medianPrice;
      }
      if (data.medianPriceUnit != null) sub.medianPriceUnit = data.medianPriceUnit;
      if (data.annualChange != null) sub.annualChange = data.annualChange;
      updated++;
      console.log(`[${i + 1}/${total}] ${name}: house ${sub.medianPrice != null ? '$' + (sub.medianPrice / 1000) + 'k' : '-'}, unit ${sub.medianPriceUnit != null ? '$' + (sub.medianPriceUnit / 1000) + 'k' : '-'}`);
    } else {
      console.log(`[${i + 1}/${total}] ${name}: no data`);
    }
    if ((i + 1) % 20 === 0) {
      fs.writeFileSync(suburbsPath, JSON.stringify(suburbs, null, 2) + '\n', 'utf8');
      console.log(`  ... saved (${updated} updated)`);
    }
    if (i < total - 1) await sleep(REIV_DELAY_MS);
  }

  await browser.close();
  suburbs.metadata.notes = (suburbs.metadata.notes || '').replace(/\s*Prices from REIV[^.]*\.?/g, '').trim();
  suburbs.metadata.notes = (suburbs.metadata.notes || '') + ' Prices from REIV (House + Unit tabs) where VPSR not available.';
  fs.writeFileSync(suburbsPath, JSON.stringify(suburbs, null, 2) + '\n', 'utf8');
  console.log(`Done. Updated ${updated} suburbs.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
