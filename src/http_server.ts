import dotenv from "dotenv";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { URL } from "url";

import {
  buildSpaceWeatherContext,
  fetchCoronalMassEjections,
  fetchNoaaSwpcAlerts,
  getErrorMessage,
  normalizeDateWindow,
} from "./data.js";

dotenv.config();

const HTTP_HOST = process.env.HTTP_HOST || "0.0.0.0";
const HTTP_PORT = Number(process.env.HTTP_PORT || process.env.PORT || "6274");
const SERVICE_NAME = "geostorm-mcp-server";

type JsonBody = Record<string, unknown> | unknown[];

const server = createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (error: unknown) {
    writeJson(res, 500, {
      error: "Internal MCP HTTP service error.",
      details: getErrorMessage(error),
    });
  }
});

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    writeJson(res, 405, { error: "Method not allowed." });
    return;
  }

  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const window = normalizeDateWindow(
    requestUrl.searchParams.get("startDate"),
    requestUrl.searchParams.get("endDate"),
  );

  switch (requestUrl.pathname) {
    case "/health":
      writeJson(res, 200, { status: "ok", service: SERVICE_NAME });
      return;
    case "/ready":
      writeJson(res, 200, {
        status: "ready",
        service: SERVICE_NAME,
        nasa_api_key_configured: Boolean(process.env.NASA_API_KEY),
        esa_enabled: ["1", "true", "yes", "on"].includes(
          (process.env.ESA_ENABLED || "").trim().toLowerCase(),
        ),
      });
      return;
    case "/context":
    case "/space-weather":
      writeJson(res, 200, await buildSpaceWeatherContext(window));
      return;
    case "/nasa/donki/cmes":
      writeJson(res, 200, {
        source: SERVICE_NAME,
        date_window: window,
        data: await fetchCoronalMassEjections(window),
      });
      return;
    case "/noaa/swpc/alerts":
      writeJson(res, 200, {
        source: SERVICE_NAME,
        data: await fetchNoaaSwpcAlerts(),
      });
      return;
    default:
      writeJson(res, 404, { error: "Not found." });
  }
}

function writeJson(res: ServerResponse, statusCode: number, body: JsonBody): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

server.listen(HTTP_PORT, HTTP_HOST, () => {
  console.error(`${SERVICE_NAME} HTTP service listening on ${HTTP_HOST}:${HTTP_PORT}`);
});
