import http from "node:http";
import protobuf from "protobufjs";

const PORT = Number(process.env.PORT || 8080);
const OTD_API_KEY = process.env.OTD_API_KEY || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://delhi-move--rahul.tiniestcloud.app";
const OTD_URL = "https://otd.delhi.gov.in/api/realtime/VehiclePositions.pb";
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12000;

const root = protobuf.Root.fromJSON({
  nested: {
    transit_realtime: {
      nested: {
        FeedMessage: {
          fields: {
            header: { type: "FeedHeader", id: 1 },
            entity: { rule: "repeated", type: "FeedEntity", id: 2 }
          }
        },
        FeedHeader: {
          fields: {
            gtfsRealtimeVersion: { type: "string", id: 1 },
            incrementality: { type: "Incrementality", id: 2 },
            timestamp: { type: "uint64", id: 3 }
          }
        },
        Incrementality: { values: { FULL_DATASET: 0, DIFFERENTIAL: 1 } },
        FeedEntity: {
          fields: {
            id: { type: "string", id: 1 },
            isDeleted: { type: "bool", id: 2 },
            tripUpdate: { type: "TripUpdate", id: 3 },
            vehicle: { type: "VehiclePosition", id: 4 },
            alert: { type: "Alert", id: 5 },
            shape: { type: "Shape", id: 6 }
          }
        },
        VehiclePosition: {
          fields: {
            trip: { type: "TripDescriptor", id: 1 },
            position: { type: "Position", id: 2 },
            currentStopSequence: { type: "uint32", id: 3 },
            stopId: { type: "string", id: 4 },
            currentStatus: { type: "VehicleStopStatus", id: 5 },
            timestamp: { type: "uint64", id: 6 },
            congestionLevel: { type: "CongestionLevel", id: 7 },
            vehicle: { type: "VehicleDescriptor", id: 8 },
            occupancyStatus: { type: "OccupancyStatus", id: 9 },
            occupancyPercentage: { type: "uint32", id: 10 }
          }
        },
        TripDescriptor: {
          fields: {
            tripId: { type: "string", id: 1 },
            routeId: { type: "string", id: 5 },
            directionId: { type: "uint32", id: 6 },
            startTime: { type: "string", id: 2 },
            startDate: { type: "string", id: 3 },
            scheduleRelationship: { type: "ScheduleRelationship", id: 4 }
          }
        },
        Position: {
          fields: {
            latitude: { type: "float", id: 1 },
            longitude: { type: "float", id: 2 },
            bearing: { type: "float", id: 3 },
            odometer: { type: "double", id: 4 },
            speed: { type: "float", id: 5 }
          }
        },
        VehicleDescriptor: {
          fields: {
            id: { type: "string", id: 1 },
            label: { type: "string", id: 2 },
            licensePlate: { type: "string", id: 3 }
          }
        },
        TripUpdate: { fields: {} },
        Alert: { fields: {} },
        Shape: { fields: {} },
        VehicleStopStatus: { values: { INCOMING_AT: 0, STOPPED_AT: 1, IN_TRANSIT_TO: 2 } },
        CongestionLevel: { values: { UNKNOWN_CONGESTION_LEVEL: 0, RUNNING_SMOOTHLY: 1, STOP_AND_GO: 2, CONGESTION: 3, SEVERE_CONGESTION: 4 } },
        OccupancyStatus: { values: { EMPTY: 0, MANY_SEATS_AVAILABLE: 1, FEW_SEATS_AVAILABLE: 2, STANDING_ROOM_ONLY: 3, CRUSHED_STANDING_ROOM_ONLY: 4, FULL: 5, NOT_ACCEPTING_PASSENGERS: 6, NO_DATA_AVAILABLE: 7, NOT_BOARDABLE: 8 } },
        ScheduleRelationship: { values: { SCHEDULED: 0, ADDED: 1, UNSCHEDULED: 2, CANCELED: 3, REPLACEMENT: 5, DUPLICATED: 6, DELETED: 7 } }
      }
    }
  }
});
function sendJson(res, status, body, origin) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "vary": "Origin",
    "x-content-type-options": "nosniff"
  });
  res.end(JSON.stringify(body));
}
function corsOrigin(req) {
  const origin = req.headers.origin || "";
  const allowed = ALLOWED_ORIGIN.split(",").map(s => s.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : allowed[0] || "*";
}
async function getVehicles() {
  if (!OTD_API_KEY) {
    const error = new Error("OTD_API_KEY is not configured on the server.");
    error.status = 503;
    throw error;
  }
  const url = new URL(OTD_URL);
  url.searchParams.set("key", OTD_API_KEY);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/x-protobuf, application/octet-stream" },
      signal: controller.signal
    });
  } catch (err) {
    const error = new Error(err?.name === "AbortError" ? "Delhi OTD feed timed out." : "Could not reach Delhi OTD feed.");
    error.status = 502;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const error = new Error(`Delhi OTD feed returned HTTP ${response.status}. Check API key approval and feed access.`);
    error.status = 502;
    throw error;
  }
  const contentType = response.headers.get("content-type") || "unknown";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    const error = new Error("Delhi OTD returned an empty feed.");
    error.status = 502;
    throw error;
  }
  if (buffer.length > MAX_RESPONSE_BYTES) {
    const error = new Error("Delhi OTD feed exceeded the configured size limit.");
    error.status = 502;
    throw error;
  }
  let decoded;
  try {
    const FeedMessage = root.lookupType("transit_realtime.FeedMessage");
    decoded = FeedMessage.decode(buffer);
  } catch {
    const error = new Error("Delhi OTD responded, but the body could not be decoded as GTFS-Realtime protobuf.");
    error.status = 502;
    throw error;
  }
  const header = decoded.header || {};
  const entities = decoded.entity || [];
  const vehicles = [];
  for (const entity of entities) {
    const v = entity.vehicle;
    const p = v?.position;
    if (!p || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
    if (p.latitude < -90 || p.latitude > 90 || p.longitude < -180 || p.longitude > 180) continue;
    const timestamp = v.timestamp ? Number(v.timestamp) : null;
    vehicles.push({
      id: v.vehicle?.label || v.vehicle?.id || entity.id || `vehicle-${vehicles.length + 1}`,
      route: v.trip?.routeId || "",
      tripId: v.trip?.tripId || "",
      lat: p.latitude,
      lon: p.longitude,
      bearing: Number.isFinite(p.bearing) ? p.bearing : null,
      speed: Number.isFinite(p.speed) ? p.speed : null,
      vehicleTimestamp: timestamp && Number.isFinite(timestamp) ? new Date(timestamp * 1000).toISOString() : null
    });
  }
  return {
    reachable: true,
    status: response.status,
    contentType,
    checkedAt: new Date().toISOString(),
    feedTimestamp: header.timestamp ? new Date(Number(header.timestamp) * 1000).toISOString() : null,
    vehicleCount: vehicles.length,
    vehicles
  };
}
const server = http.createServer(async (req, res) => {
  const origin = corsOrigin(req);
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "Content-Type",
      "access-control-max-age": "86400",
      "vary": "Origin"
    });
    return res.end();
  }
  const path = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;
  if (req.method === "GET" && path === "/health") {
    return sendJson(res, 200, { ok: true, service: "delhi-move-bus-api", configured: Boolean(OTD_API_KEY), timestamp: new Date().toISOString() }, origin);
  }
  if (req.method === "GET" && path === "/api/vehicles") {
    try {
      const data = await getVehicles();
      return sendJson(res, 200, data, origin);
    } catch (err) {
      const status = Number(err?.status) || 500;
      return sendJson(res, status, {
        reachable: false,
        status,
        checkedAt: new Date().toISOString(),
        vehicleCount: 0,
        vehicles: [],
        error: err?.message || "Unexpected server error."
      }, origin);
    }
  }
  if (req.method === "GET" && path === "/") {
    return sendJson(res, 200, {
      service: "Delhi Move Bus API",
      endpoints: { health: "/health", vehicles: "/api/vehicles" },
      note: "Independent backend for Delhi Move. No ticketing or fare API is provided."
    }, origin);
  }
  return sendJson(res, 404, { error: "Not found" }, origin);
});
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Delhi Move Bus API listening on 0.0.0.0:${PORT}`);
});
