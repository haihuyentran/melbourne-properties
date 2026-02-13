# Melbourne Property Finder

Interactive map showing Melbourne suburbs with real property data from Victorian Government sources.

## Features

- 49 Melbourne suburbs with median house prices
- 10-year price history charts
- Match scoring based on your criteria ($1-1.4M budget)
- School, transport, and demographic information
- Links to search for current listings

## Local Development

```bash
npm install
npm start
# Open http://localhost:3000/melbourne-properties.html
```

## Data Sources

- **Median Prices**: Victorian Property Sales Report (Land Victoria)
- **Demographics**: ABS Census
- **Schools**: Victorian Government education data

## Production Deployment

### Option 1: Railway (Recommended)

1. Push code to GitHub
2. Go to [railway.app](https://railway.app)
3. Connect your GitHub repo
4. No API keys required for listing assessment or transit (uses OpenStreetMap)
5. Deploy automatically

### Option 2: Render

1. Push code to GitHub
2. Go to [render.com](https://render.com)
3. Create new Web Service
4. Connect GitHub repo
5. Settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
6. Add environment variables in dashboard

### Option 3: Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Launch app
fly launch

# Set secrets
# No secrets required for basic operation

# Deploy
fly deploy
```

### Option 4: Docker

```bash
docker build -t melbourne-properties .
docker run -p 3000:3000 melbourne-properties
```

### Option 5: VPS (DigitalOcean, AWS, etc.)

```bash
# On your server
git clone your-repo
cd melbourne-properties
npm install
npm install -g pm2
pm2 start server.js --name melbourne-properties
pm2 save
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port (default: 3000) | No |

Transit to Southern Cross and nearest stops use **OpenStreetMap** (Nominatim + Overpass) — no API key required.

## Updating Data

Property data is stored in `data/suburbs.json`. To update:

1. Download latest data from [Land Victoria Property Sales Statistics](https://www.land.vic.gov.au/valuations/resources-and-reports/property-sales-statistics)
2. Update the JSON file with new median prices
3. Redeploy

## License

MIT
