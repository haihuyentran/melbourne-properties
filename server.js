require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Load local suburb data
let suburbData = null;
function loadSuburbData() {
    try {
        const dataPath = path.join(__dirname, 'data', 'suburbs.json');
        const rawData = fs.readFileSync(dataPath, 'utf8');
        suburbData = JSON.parse(rawData);
        console.log(`✓ Loaded suburb data: ${Object.keys(suburbData.suburbs).length} suburbs`);
        console.log(`  Source: ${suburbData.metadata.source}`);
        console.log(`  Data quarter: ${suburbData.metadata.dataQuarter}`);
        return true;
    } catch (error) {
        console.error('Failed to load suburb data:', error.message);
        return false;
    }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.redirect(302, '/melbourne-properties.html');
});

// API endpoint to get all suburbs data
app.get('/api/suburbs', (req, res) => {
    if (!suburbData) {
        return res.status(500).json({ error: 'Suburb data not loaded' });
    }
    res.json(suburbData);
});

// API endpoint to get single suburb data
app.get('/api/suburbs/:name', (req, res) => {
    if (!suburbData) {
        return res.status(500).json({ error: 'Suburb data not loaded' });
    }
    
    const suburbName = req.params.name;
    const suburb = suburbData.suburbs[suburbName];
    
    if (!suburb) {
        return res.status(404).json({ error: `Suburb '${suburbName}' not found` });
    }
    
    res.json({
        name: suburbName,
        metadata: suburbData.metadata,
        ...suburb
    });
});

// API endpoint to get data source metadata
app.get('/api/metadata', (req, res) => {
    if (!suburbData) {
        return res.status(500).json({ error: 'Suburb data not loaded' });
    }
    res.json(suburbData.metadata);
});

// Shared fetch options for scraping listing pages
const SCRAPE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-AU,en;q=0.9',
    'Referer': 'https://www.domain.com.au/',
    'Cache-Control': 'no-cache'
};

const SCRAPE_TIMEOUT_MS = 15000;

// Extract suburb from Domain URL slug: ...-south-morang-vic-3752-2020549940 -> South Morang
function suburbFromDomainUrl(url) {
    const pathMatch = url.match(/domain\.com\.au\/([^/?#]+)/i);
    if (!pathMatch) return null;
    const parts = pathMatch[1].split('-');
    const vicIdx = parts.findIndex(p => /^(nsw|vic|qld|sa|wa|tas|nt|act)$/i.test(p));
    if (vicIdx <= 0) return null;
    const suburbParts = parts.slice(0, vicIdx).filter(p => !/^\d+$/.test(p));
    const raw = suburbParts.join(' ');
    return raw ? raw.replace(/\b\w/g, c => c.toUpperCase()) : null;
}

// Fetch domain.com.au listing page and extract listing details from HTML (no API needed)
async function fetchDomainListingByScrape(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
    const res = await fetch(url, {
        headers: SCRAPE_HEADERS,
        redirect: 'follow',
        signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (html.length < 5000 && (/blocked|captcha|challenge|access denied|robot/i.test(html))) {
        throw new Error('Page returned a block or challenge');
    }

    const suburb = suburbFromDomainUrl(url);

    // Price: $1,100,000 - $1,210,000 or $1.1m
    let price = null;
    const priceRangeMatch = html.match(/\$[\d,]+(?:\s*-\s*\$?[\d,]+)?/g);
    if (priceRangeMatch) {
        for (const s of priceRangeMatch) {
            const numStr = s.replace(/\$/g, '').replace(/,/g, '').split(/\s*-\s*/)[0].trim();
            const num = parseInt(numStr, 10);
            if (!isNaN(num) && num > 10000 && num < 50000000) {
                price = num;
                break;
            }
        }
    }
    if (price == null) {
        const priceM = html.match(/\$(\d(?:\.\d)?)\s*[mM]/);
        if (priceM) price = Math.round(parseFloat(priceM[1]) * 1e6);
    }

    // Beds, baths, parking: "5 Beds", "3 Baths", "2 Parking"
    let bedrooms = null, bathrooms = null, garage = null;
    const bedsMatch = html.match(/(\d+)\s*Bed(?:s|room)?/i);
    if (bedsMatch) bedrooms = parseInt(bedsMatch[1], 10);
    const bathsMatch = html.match(/(\d+)\s*Bath(?:s|room)?/i);
    if (bathsMatch) bathrooms = parseInt(bathsMatch[1], 10);
    const parkMatch = html.match(/(\d+)\s*(?:Parking|Car|Garage)/i);
    if (parkMatch) garage = parseInt(parkMatch[1], 10);

    let propertyType = 'House';
    const typeMatch = html.match(/>\s*(House|Unit|Townhouse|Villa|Apartment)\s*</i);
    if (typeMatch) propertyType = typeMatch[1];

    const lowerHtml = html.toLowerCase();
    const garden = /garden|courtyard|yard|outdoor\s*space/i.test(lowerHtml) ? 'yes' : 'unknown';
    const pool = /swimming\s*pool|pool\s*</i.test(lowerHtml) ? 'yes' : (/pool/i.test(lowerHtml) ? 'yes' : 'unknown');

    let displayAddress = suburb ? `${suburb}, VIC` : 'Unknown';
    const titleMatch = html.match(/<title[^>]*>([^<]+)</i);
    if (titleMatch) {
        const t = titleMatch[1].replace(/\s*\|\s*.*$/, '').trim();
        if (t.length > 5 && t.length < 120) displayAddress = t;
    }

    return {
        price,
        suburb,
        bedrooms,
        bathrooms,
        garage,
        propertyType,
        garden,
        pool,
        displayAddress
    };
}

// Fetch realestate.com.au listing page and extract listing details from HTML
async function fetchRealestateListing(url) {
    const res = await fetch(url, { headers: SCRAPE_HEADERS, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // Suburb from URL: e.g. /property-house-vic-south+morang-150086368 -> South Morang
    let suburb = null;
    const urlMatch = url.match(/\/(?:nsw|vic|qld|sa|wa|tas|nt|act)-([^-\d?]+?)(?:-\d+)?(?:\?|$)/i);
    if (urlMatch) {
        const raw = (urlMatch[1] || '').replace(/\+/g, ' ').trim();
        suburb = raw ? raw.replace(/\b\w/g, c => c.toUpperCase()) : null;
    }

    // Price: $1,100,000 - $1,210,000 or $1.1m or "price":1200000
    let price = null;
    const priceRangeMatch = html.match(/\$[\d,]+(?:\s*-\s*\$?[\d,]+)?/g);
    if (priceRangeMatch) {
        for (const s of priceRangeMatch) {
            const numStr = s.replace(/\$/g, '').replace(/,/g, '').split(/\s*-\s*/)[0].trim();
            const num = parseInt(numStr, 10);
            if (!isNaN(num) && num > 10000 && num < 50000000) {
                price = num;
                break;
            }
        }
    }
    if (price == null) {
        const priceJsonMatch = html.match(/"price":\s*(\d+)/);
        if (priceJsonMatch) price = parseInt(priceJsonMatch[1], 10);
    }
    if (price == null) {
        const priceM = html.match(/\$(\d(?:\.\d)?)\s*[mM]/);
        if (priceM) price = Math.round(parseFloat(priceM[1]) * 1e6);
    }

    // Beds, baths, parking: "5 Beds", "3 Baths", "2 Parking" or similar
    let bedrooms = null, bathrooms = null, garage = null;
    const bedsMatch = html.match(/(\d+)\s*Bed(?:s|room)?/i);
    if (bedsMatch) bedrooms = parseInt(bedsMatch[1], 10);
    const bathsMatch = html.match(/(\d+)\s*Bath(?:s|room)?/i);
    if (bathsMatch) bathrooms = parseInt(bathsMatch[1], 10);
    const parkMatch = html.match(/(\d+)\s*(?:Parking|Car|Garage)/i);
    if (parkMatch) garage = parseInt(parkMatch[1], 10);

    // Property type: House, Unit, etc. from URL or page
    let propertyType = 'House';
    if (/property-unit|apartment|unit/i.test(url)) propertyType = 'Unit';
    else if (/property-townhouse|townhouse/i.test(url)) propertyType = 'Townhouse';
    else if (/property-house|house/i.test(url)) propertyType = 'House';
    const typeMatch = html.match(/>\s*(House|Unit|Townhouse|Villa|Apartment)\s*</i);
    if (typeMatch) propertyType = typeMatch[1];

    // Features
    const lowerHtml = html.toLowerCase();
    const garden = /garden|courtyard|yard|outdoor\s*space/i.test(lowerHtml) ? 'yes' : 'unknown';
    const pool = /swimming\s*pool|pool\s*</i.test(lowerHtml) ? 'yes' : (/pool/i.test(lowerHtml) ? 'yes' : 'unknown');

    // Display address: try meta or title
    let displayAddress = suburb ? `${suburb}, VIC` : 'Unknown';
    const titleMatch = html.match(/<title[^>]*>([^<]+)</i);
    if (titleMatch) {
        const t = titleMatch[1].replace(/\s*\|\s*.*$/, '').trim();
        if (t.length > 5 && t.length < 120) displayAddress = t;
    }

    return {
        price,
        suburb,
        bedrooms,
        bathrooms,
        garage,
        propertyType,
        garden,
        pool,
        displayAddress
    };
}

// Fetch listing by URL (Domain API or realestate.com.au page scrape)
app.post('/api/listing-from-url', async (req, res) => {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid url' });
    }

    const parsed = new URL(url, 'https://example.com');
    const host = (parsed.hostname || '').toLowerCase();

    if (host.includes('domain.com.au')) {
        try {
            const listing = await fetchDomainListingByScrape(url);
            return res.json({ listing, source: 'domain', listingUrl: url });
        } catch (error) {
            console.error('Domain scrape error:', error.message || error);
            const suggestedSuburb = suburbFromDomainUrl(url);
            return res.status(502).json({
                error: 'Domain often blocks automated requests. Use the form below — we\'ve filled in the suburb from your URL. Add price, beds, baths and other details from the listing page, then click "Assess manual entry".',
                useManualForm: true,
                suggestedSuburb: suggestedSuburb || undefined
            });
        }
    }

    if (host.includes('realestate.com.au')) {
        try {
            const listing = await fetchRealestateListing(url);
            return res.json({ listing, source: 'realestate', listingUrl: url });
        } catch (error) {
            console.error('Realestate fetch error:', error);
            return res.status(502).json({
                error: 'Could not load the realestate.com.au listing. The page may be unavailable or the URL may be incorrect.',
                useManualForm: true
            });
        }
    }

    return res.status(400).json({
        error: 'Please use a listing URL from domain.com.au or realestate.com.au.'
    });
});

// Static commute times (matches frontend) for OpenStreetMap transit
const COMMUTE_TO_SOUTHERN_CROSS = {
    'Glen Waverley': '45 min by train', 'Box Hill': '35 min by train', 'Doncaster': '50 min by bus',
    'Ringwood': '45 min by train', 'Camberwell': '25 min by train', 'Moorabbin': '35 min by train',
    'Preston': '25 min by train', 'Blackburn': '40 min by train', 'Reservoir': '30 min by train',
    'Coburg': '25 min by train', 'Brunswick': '20 min by train', 'Footscray': '15 min by train',
    'Sunshine': '25 min by train', 'St Albans': '35 min by train', 'Werribee': '45 min by train',
    'Point Cook': '50 min by bus', 'Craigieburn': '45 min by train', 'South Morang': '50 min by train',
    'Epping': '45 min by train', 'Bundoora': '40 min by bus', 'Heidelberg': '30 min by train',
    'Ivanhoe': '25 min by train', 'Kew': '20 min by bus', 'Hawthorn': '15 min by train',
    'Malvern': '20 min by train', 'Caulfield': '20 min by train', 'Bentleigh': '30 min by train',
    'Cheltenham': '35 min by train', 'Mentone': '40 min by train', 'Frankston': '55 min by train',
    'Clayton': '35 min by train', 'Dandenong': '45 min by train', 'Berwick': '50 min by train',
    'Croydon': '55 min by train', 'Lilydale': '60 min by train', 'Belgrave': '65 min by train',
    'Williamstown': '25 min by train', 'Altona': '35 min by train', 'Newport': '20 min by train',
    'Essendon': '20 min by train', 'Moonee Ponds': '15 min by train', 'Pascoe Vale': '25 min by train',
    'Niddrie': '25 min by bus', 'Northcote': '20 min by train', 'Thornbury': '22 min by train',
    'Fairfield': '20 min by train', 'Mount Waverley': '40 min by train', 'Mulgrave': '45 min by bus',
    'Wheelers Hill': '50 min by bus', 'Mill Park': '40 min by train', 'Doreen': '55 min by bus',
    'Mernda': '55 min by train', 'Lara': '45 min by train (V/Line)', 'Geelong': '~1h by train (V/Line)'
};
const COMMUTE_TO_COLLINGWOOD = {
    'Glen Waverley': '55 min', 'Box Hill': '50 min', 'Doncaster': '40 min', 'Ringwood': '1h 10min',
    'Camberwell': '20 min', 'Moorabbin': '1h', 'Preston': '25 min', 'Blackburn': '58 min',
    'Reservoir': '35 min', 'Coburg': '30 min', 'Brunswick': '25 min', 'Footscray': '30 min',
    'Sunshine': '40 min', 'St Albans': '50 min', 'Werribee': '1h', 'Point Cook': '1h 10min',
    'Craigieburn': '55 min', 'South Morang': '45 min', 'Epping': '40 min', 'Bundoora': '35 min',
    'Heidelberg': '25 min', 'Ivanhoe': '20 min', 'Kew': '15 min', 'Hawthorn': '15 min',
    'Malvern': '25 min', 'Caulfield': '30 min', 'Bentleigh': '40 min', 'Cheltenham': '45 min',
    'Mentone': '50 min', 'Frankston': '1h 10min', 'Clayton': '45 min', 'Dandenong': '55 min',
    'Berwick': '1h', 'Croydon': '1h 5min', 'Lilydale': '1h 10min', 'Belgrave': '1h 15min',
    'Williamstown': '35 min', 'Altona': '45 min', 'Newport': '30 min', 'Essendon': '30 min',
    'Moonee Ponds': '25 min', 'Pascoe Vale': '30 min', 'Niddrie': '35 min', 'Northcote': '15 min',
    'Thornbury': '18 min', 'Fairfield': '15 min', 'Mount Waverley': '50 min', 'Mulgrave': '55 min',
    'Wheelers Hill': '1h', 'Mill Park': '35 min', 'Doreen': '50 min', 'Mernda': '50 min',
    'Lara': '1h 5min', 'Geelong': '1h 15min'
};

// Office locations for distance display (listing → office)
const SIEMENS_OFFICE = { lat: -37.8190, lon: 144.9460, label: 'Siemens (380 Docklands Dr, Docklands)' };
const CANVA_OFFICE = { lat: -37.8024, lon: 144.9927, label: 'Canva (30 Rupert St, Collingwood)' };

function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Driving distance/duration via OSRM (OpenStreetMap-based). Coordinates: lon,lat (GeoJSON order).
async function getDrivingRouteOSRM(lat1, lon1, lat2, lon2) {
    const coords = `${lon1},${lat1};${lon2},${lat2}`;
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'MelbournePropertyFinder/1.0' } });
        const data = await res.json();
        if (data.code !== 'Ok' || !data.routes?.[0]) return null;
        const r = data.routes[0];
        const distanceKm = Math.round((r.distance / 1000) * 100) / 100;
        const durationMinutes = Math.round(r.duration / 60);
        return { distanceKm, durationMinutes };
    } catch (e) {
        return null;
    }
}

// Safe parse: OSM/Overpass sometimes return XML or HTML error pages instead of JSON (e.g. rate limit, 503).
function parseJsonResponse(res, bodyText) {
    const text = (bodyText || '').trim();
    if (!res.ok) {
        throw new Error(`OpenStreetMap API error (HTTP ${res.status}). Try again later.`);
    }
    if (text.startsWith('<')) {
        throw new Error('OpenStreetMap API returned an error page (rate limit or temporary failure). Try again later.');
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error('Invalid JSON from external API.');
    }
}

// Fetch nearest train, tram, bus stops from OpenStreetMap (Overpass). Used for suburb analysis.
async function fetchNearbyStopsFromOSM(lat, lon, radiusM = 2500) {
    const overpassUrl = 'https://overpass-api.de/api/interpreter';
    const overpassQuery = `[out:json][timeout:12];(node["railway"="station"](around:${radiusM},${lat},${lon});node["railway"="halt"](around:${radiusM},${lat},${lon});node["public_transport"="stop_position"](around:${radiusM},${lat},${lon});node["highway"="bus_stop"](around:${radiusM},${lat},${lon}););out body;`;
    const res = await fetch(overpassUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(overpassQuery)
    });
    const bodyText = await res.text();
    const data = parseJsonResponse(res, bodyText);
    const elements = data.elements || [];
    const stops = elements.map(el => {
        const name = el.tags?.name || el.tags?.station || 'Stop';
        let type = 'Bus';
        if (el.tags?.railway === 'station' || el.tags?.railway === 'halt') type = 'Train';
        else if (el.tags?.tram === 'yes' || el.tags?.light_rail === 'yes' || (el.tags?.public_transport && !el.tags?.bus)) type = 'Tram';
        const dist = haversineKm(lat, lon, el.lat, el.lon);
        return { name, type, distanceKm: Math.round(dist * 100) / 100 };
    });
    stops.sort((a, b) => a.distanceKm - b.distanceKm);
    const byType = { Train: null, Tram: null, Bus: null };
    for (const s of stops) {
        if (!byType[s.type]) byType[s.type] = s;
    }
    return { train: byType.Train, tram: byType.Tram, bus: byType.Bus };
}

app.get('/api/nearby-stops', async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    if (isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({ error: 'Missing or invalid lat, lon' });
    }
    try {
        const result = await fetchNearbyStopsFromOSM(lat, lon);
        return res.json(result);
    } catch (error) {
        console.error('Nearby stops error:', error);
        return res.status(500).json({ error: error.message });
    }
});

// REIV suburb page cache (slug -> { data, at }) to avoid hammering REIV
const reivCache = new Map();
const REIV_CACHE_TTL_MS = 5 * 60 * 1000;

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

async function fetchREIVSuburbPrices(slug) {
    const now = Date.now();
    const cached = reivCache.get(slug);
    if (cached && (now - cached.at) < REIV_CACHE_TTL_MS) return cached.data;

    const url = `https://reiv.com.au/market-insights/suburb/${encodeURIComponent(slug)}`;
    const res = await fetch(url, {
        headers: { 'User-Agent': 'MelbournePropertyFinder/1.0 (market data)' }
    });
    if (!res.ok) return null;
    const html = await res.text();

    const result = { medianPrice: null, medianPriceUnit: null, quarterlyChange: null, source: 'reiv' };
    // Median sale price: e.g. "$1mil" or "$643k" in the page
    const medianSaleMatch = html.match(/Median\s*sale\s*price[\s\S]*?\$[\s\S]*?(\d+(?:\.\d+)?\s*(?:mil|m|k|,\d{3}))/i)
        || html.match(/\$(\d(?:\.\d+)?)\s*mi?l/i)
        || html.match(/\$(\d+(?:\.\d+)?)\s*k/i)
        || html.match(/\$([\d,]+)/);
    if (medianSaleMatch) {
        const raw = medianSaleMatch[1].replace(/,/g, '').trim();
        if (/mil|m\b/i.test(html.substring(html.indexOf(medianSaleMatch[0]), html.indexOf(medianSaleMatch[0]) + 50)))
            result.medianPrice = Math.round(parseFloat(raw) * 1e6);
        else if (/k/i.test(raw)) result.medianPrice = Math.round(parseFloat(raw) * 1000);
        else result.medianPrice = parseInt(raw, 10);
    }
    // Try to find Units median from table (e.g. "Units" tab or table row)
    const unitsSection = html.match(/Units[\s\S]*?(?:median|price)[\s\S]*?\$[\s\S]*?(\d+(?:\.\d+)?\s*(?:mil|m|k)|[\d,]+)/i);
    if (unitsSection) {
        const unitPrice = parsePriceFromText(unitsSection[0]);
        if (unitPrice) result.medianPriceUnit = unitPrice;
    }
    // Quarterly price change: e.g. "9.7%"
    const qChangeMatch = html.match(/Quarterly\s*price\s*change[\s\S]*?([-]?\d+(?:\.\d+)?)\s*%/i);
    if (qChangeMatch) result.quarterlyChange = parseFloat(qChangeMatch[1]);

    reivCache.set(slug, { data: result, at: now });
    return result;
}

app.get('/api/reiv/suburb/:slug', async (req, res) => {
    let slug = (req.params.slug || '').trim();
    if (!slug) return res.status(400).json({ error: 'Missing suburb slug' });
    slug = decodeURIComponent(slug).replace(/\s+/g, ' ');
    try {
        const data = await fetchREIVSuburbPrices(slug);
        if (!data) return res.status(404).json({ error: 'REIV data not found for this suburb' });
        return res.json(data);
    } catch (error) {
        console.error('REIV fetch error:', error);
        return res.status(502).json({ error: error.message });
    }
});

// Transit info using OpenStreetMap (Nominatim + Overpass). No API key required.
app.get('/api/transit-to-southern-cross', async (req, res) => {
    const address = (req.query.address || '').trim();
    if (!address) {
        return res.status(400).json({ error: 'Missing address (e.g. suburb name or full address)' });
    }
    const query = address.includes('VIC') || address.includes('Australia') ? address : `${address}, Victoria, Australia`;
    try {
        const nomUrl = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
            q: query,
            format: 'json',
            limit: 1,
            countrycodes: 'au'
        })}`;
        const geoRes = await fetch(nomUrl, {
            headers: { 'User-Agent': 'MelbournePropertyFinder/1.0' }
        });
        const geoBody = await geoRes.text();
        const geoList = parseJsonResponse(geoRes, geoBody);
        if (!geoList || geoList.length === 0) {
            return res.json({
                address: query,
                destination: 'Southern Cross Station',
                durationText: null,
                steps: [],
                walkToFirstStop: null,
                message: 'Address not found. Try suburb name (e.g. South Morang).'
            });
        }
        const { lat, lon, display_name } = geoList[0];
        const latNum = parseFloat(lat);
        const lonNum = parseFloat(lon);

        const suburbFromAddress = (name) => {
            const suburbKeys = Object.keys(COMMUTE_TO_SOUTHERN_CROSS);
            for (const key of suburbKeys) {
                if (name.toLowerCase().includes(key.toLowerCase())) return key;
            }
            return null;
        };
        const matchedSuburb = suburbFromAddress(display_name) || suburbFromAddress(query);
        const durationText = matchedSuburb ? COMMUTE_TO_SOUTHERN_CROSS[matchedSuburb] : null;
        const durationTextCollingwood = matchedSuburb ? COMMUTE_TO_COLLINGWOOD[matchedSuburb] : null;

        const overpassUrl = 'https://overpass-api.de/api/interpreter';
        const radius = 2500;
        const overpassQuery = `[out:json][timeout:15];(node["railway"="station"](around:${radius},${latNum},${lonNum});node["railway"="halt"](around:${radius},${latNum},${lonNum});node["public_transport"="stop_position"](around:${radius},${latNum},${lonNum});node["highway"="bus_stop"](around:${radius},${latNum},${lonNum}););out body;`;
        const overRes = await fetch(overpassUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(overpassQuery)
        });
        const overBody = await overRes.text();
        const overData = parseJsonResponse(overRes, overBody);
        const elements = overData.elements || [];
        const stops = elements.map(el => {
            const name = el.tags?.name || el.tags?.station || 'Stop';
            let type = 'Bus';
            if (el.tags?.railway === 'station' || el.tags?.railway === 'halt') type = 'Train';
            else if (el.tags?.tram === 'yes' || el.tags?.light_rail === 'yes' || (el.tags?.public_transport && !el.tags?.bus)) type = 'Tram';
            const dist = haversineKm(latNum, lonNum, el.lat, el.lon);
            return { name, type, distanceKm: Math.round(dist * 100) / 100, lat: el.lat, lon: el.lon };
        });
        stops.sort((a, b) => a.distanceKm - b.distanceKm);
        const byType = { Train: null, Tram: null, Bus: null };
        for (const s of stops) {
            if (!byType[s.type]) byType[s.type] = s;
        }
        const steps = [byType.Train, byType.Tram, byType.Bus].filter(Boolean).map(s => ({
            departureStop: s.name,
            vehicleType: s.type,
            lineShortName: null,
            summary: `${s.name} – ${s.type} (${s.distanceKm} km)`
        }));
        const firstStop = stops[0];
        let walkToFirstStop = null;
        if (firstStop) {
            const walkKm = firstStop.distanceKm;
            const walkMin = Math.round(walkKm * 12);
            walkToFirstStop = { distance: walkKm < 1 ? `${Math.round(walkKm * 1000)} m` : `${walkKm.toFixed(1)} km`, duration: `~${walkMin} min walk` };
        }
        const haversineSiemens = Math.round(haversineKm(latNum, lonNum, SIEMENS_OFFICE.lat, SIEMENS_OFFICE.lon) * 100) / 100;
        const haversineCanva = Math.round(haversineKm(latNum, lonNum, CANVA_OFFICE.lat, CANVA_OFFICE.lon) * 100) / 100;
        const [driveSiemens, driveCanva] = await Promise.all([
            getDrivingRouteOSRM(latNum, lonNum, SIEMENS_OFFICE.lat, SIEMENS_OFFICE.lon),
            getDrivingRouteOSRM(latNum, lonNum, CANVA_OFFICE.lat, CANVA_OFFICE.lon)
        ]);
        const distanceSiemensKm = driveSiemens ? driveSiemens.distanceKm : haversineSiemens;
        const distanceCanvaKm = driveCanva ? driveCanva.distanceKm : haversineCanva;
        const distanceSiemensSource = driveSiemens ? 'driving' : 'straight-line';
        const distanceCanvaSource = driveCanva ? 'driving' : 'straight-line';
        return res.json({
            address: display_name,
            destination: 'Southern Cross Station',
            durationText,
            durationTextCollingwood: durationTextCollingwood || null,
            durationValue: null,
            steps,
            walkToFirstStop,
            suburb: matchedSuburb || null,
            distanceSiemensKm,
            distanceCanvaKm,
            distanceSiemensSource,
            distanceCanvaSource,
            durationSiemensDrivingMin: driveSiemens ? driveSiemens.durationMinutes : null,
            durationCanvaDrivingMin: driveCanva ? driveCanva.durationMinutes : null
        });
    } catch (error) {
        console.error('Transit (OSM) error:', error);
        return res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n🏠 Melbourne Property Finder`);
    console.log(`   Server running at http://localhost:${PORT}`);
    console.log(`   Open http://localhost:${PORT}/melbourne-properties.html\n`);
    
    // Load local suburb data
    loadSuburbData();
});
