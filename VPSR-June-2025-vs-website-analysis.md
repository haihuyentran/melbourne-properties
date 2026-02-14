# VPSR June 2025 vs website price data – analysis

## Data sources

| Source | Period | File / location |
|--------|--------|------------------|
| **VPSR (PDF)** | June 2025 quarter (Apr–Jun 2025), released Dec 2025 | `vpsr-june-2025-data-released-dec-2025.pdf` |
| **Website** | Q1 2025, lastUpdated 2025-03-01 | `data/suburbs.json` (metadata: Land Victoria, Q1 2025) |

Both use the same underlying source: **Victorian Property Sales Report – Land Victoria** (Notices of Acquisition, Valuer-General). The difference is **quarter**: website is **Q1 2025** (Jan–Mar), PDF is **Q2 2025** (Apr–Jun).

---

## Summary of differences

1. **Quarter**  
   - Website: **Q1 2025** (Jan–Mar).  
   - PDF: **June 2025 quarter** (Apr–Jun 2025).

2. **Median house prices**  
   For most suburbs that appear in both, the **PDF (Jun 2025) median is different** from the website (Q1 2025). Some go up, some down; a few are unchanged.

3. **Structure**  
   - PDF: full locality list (753 locations), median **house**, **unit**, and **residential land** tables, quarterly columns (e.g. Apr–Jun 2024, Jan–Mar 2025, Apr–Jun 2025), YoY and QoQ % change, and sales counts.  
   - Website: a **subset of suburbs** with a single `medianPrice` (house), `medianPriceUnit`, `annualChange`, `salesCount`, and 10-year `priceHistory` (yearly). No quarterly breakdown.

4. **Coverage**  
   - PDF: all Victorian localities in the report.  
   - Website: only the suburbs stored in `suburbs.json` (curated list for the app).

---

## Suburb-by-suburb comparison (median house, $)

*Website = `suburbs.json` (Q1 2025). PDF = VPSR June 2025 quarter (Apr–Jun 2025).*

| Suburb      | Website (Q1 2025) | PDF (Jun 2025) | Difference ($) | Note |
|------------|--------------------|-----------------|----------------|------|
| Box Hill   | 1,380,000          | 1,698,000      | +318,000       | PDF much higher |
| Camberwell | 2,250,000          | 2,460,000      | +210,000       | PDF higher |
| Glen Waverley | 1,485,000       | 1,710,000      | +225,000       | PDF higher |
| Doncaster  | 1,650,000          | 1,554,000      | −96,000        | Website higher |
| Ringwood   | 1,085,000          | 1,002,500      | −82,500        | Website higher |
| Moorabbin  | 1,280,000          | 1,210,500      | −69,500        | Website higher |
| Bentleigh  | 1,520,000          | 1,750,000      | +230,000       | PDF higher |
| Blackburn  | 1,420,000          | 1,673,800      | +253,800       | PDF higher |
| Preston    | 1,150,000          | 1,230,000      | +80,000        | PDF higher |
| Reservoir  | 920,000             | 920,000        | 0              | Same |
| Coburg     | 1,180,000          | 1,210,000      | +30,000        | PDF higher |
| Brunswick  | 1,320,000          | 1,280,000      | −40,000        | Website higher |
| Footscray  | 1,050,000          | 880,000        | −170,000       | Website much higher |
| Sunshine   | 780,000             | 823,000        | +43,000        | PDF higher |
| St Albans  | 680,000             | 680,000        | 0              | Same |
| Werribee   | 620,000             | 641,000        | +21,000        | PDF higher |
| Point Cook | 720,000             | 800,000        | +80,000        | PDF higher |
| Craigieburn | 650,000            | 700,000        | +50,000        | PDF higher |
| South Morang | 750,000           | 805,000        | +55,000        | PDF higher |
| Epping     | 720,000             | 723,000        | +3,000         | Very close |
| Bundoora   | 950,000             | 866,400        | −83,600        | Website higher |
| Northcote  | (not in website)    | 1,724,500      | —              | PDF only |
| Collingwood | (not in website)   | 1,403,500      | —              | PDF only |

---

## Why the numbers differ

1. **Different quarters**  
   Website shows effectively **Q1 2025** (or an annual/earlier snapshot). PDF shows **Q2 2025** (Apr–Jun). Market moves and composition of sales between quarters explain most differences.

2. **Report methodology**  
   VPSR states that the most recent quarter is **preliminary** (~93% of settled sales). Some settlements can take 120+ days, so later quarters can be revised. The website’s single `medianPrice` and `annualChange` do not distinguish quarters.

3. **Low sales**  
   The PDF marks localities with fewer than 10 sales in a quarter (e.g. “^”). Medians there can be volatile. E.g. Box Hill (PDF) has 20 sales in Apr–Jun 2025 vs 13 in Apr–Jun 2024 – small sample.

4. **Definition of “suburb”**  
   PDF uses **Locality** (official VPSR names). Website uses display names (e.g. “Glen Waverley”). Where they align, comparison is like-for-like; otherwise names may not match exactly (e.g. Box Hill vs Box Hill North/South).

---

## Recommendations

1. **Update website to a more recent quarter**  
   Align `suburbs.json` with a **post–Jun 2025** report (e.g. Sep or Dec 2025 quarter) when published, and set `metadata.lastUpdated` and `dataQuarter` accordingly.

2. **Use PDF for suburb list and medians**  
   When updating, take **median house** (and if needed **median unit**) from the “Suburb/township house price data” / “Suburb/township unit price data” tables in the PDF (or from Land Victoria’s latest release). That keeps the site consistent with the official VPSR.

3. **Add data period in the UI**  
   Show the **quarter** (e.g. “Jun 2025”) and “Source: Victorian Property Sales Report” next to median price so users know the period and source.

4. **Optional: quarterly history**  
   If you want to mirror the PDF’s quarterly view, extend `priceHistory` (or add a separate structure) with quarterly medians (e.g. `"2025-Q1": 1485000, "2025-Q2": 1710000`) and feed it from the latest VPSR each quarter.

5. **Handle low-sales suburbs**  
   For localities with few sales in the PDF (e.g. “^”), consider either flagging them on the site or using a trailing 12‑month or multi-quarter median to smooth volatility.

---

## PDF structure (quick reference)

- **Pages 15–37**: Suburb/township **house** price data (Locality, Apr–Jun 2025, Jul–Sep 2025, …, Apr–Jun 2024, % changes, No. of sales).
- **Pages 38–50**: Suburb/township **unit** price data (same layout).
- **Pages 51+**: Suburb/township **residential land** price data.
- **Explanatory notes**: “^” = fewer than 10 sales; “*” = no sales (previous non-zero carried forward); “NA” = insufficient data for % change.

Using the **first price column** (Apr–Jun 2025) from the house table gives the **June 2025 quarter median house price** for each locality.
