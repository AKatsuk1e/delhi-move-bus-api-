# Delhi Move Bus API

Standalone backend for Delhi Move's live bus map. It requests Delhi OTD's GTFS-Realtime VehiclePositions protobuf feed server-side and returns JSON coordinates. It does not modify or replace the existing Tiniest Cloud frontend.

## Endpoints

- `GET /health` — service health; `configured` indicates whether `OTD_API_KEY` is set.
- `GET /api/vehicles` — fetches and decodes the live vehicle feed and returns `{ reachable, status, checkedAt, feedTimestamp, vehicleCount, vehicles }`.
- `GET /` — service metadata.

## Render deployment

Render settings: runtime Node, build command `npm install`, start command `npm start`, health check `/health`, plan Free. Set `OTD_API_KEY` in Render's Environment page (never commit it). Set `ALLOWED_ORIGIN=https://delhi-move--rahul.tiniestcloud.app`.

After deployment, check `/health` and then `/api/vehicles`. A feed error or zero vehicles is reported honestly; the API does not fabricate positions. Free Render services sleep after inactivity and may take time to wake.

## Local run

```sh
npm install
cp .env.example .env
# Put your approved OTD API key in .env
npm start
```

## Security

- Never commit `.env`, API keys, or provider credentials.
- `/api/vehicles` is read-only.
- Verify the provider's terms, key access, and feed freshness before relying on the feed for travel.
