import axios, { AxiosError } from "axios";
import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

dotenv.config();

const NASA_DONKI_CME_URL = "https://api.nasa.gov/DONKI/CME";
const NOAA_SWPC_ALERTS_URL = "https://services.swpc.noaa.gov/products/alerts.json";
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The high-level MCP server instance exposed to the Python AI Insight Engine.
 * Stdio transport is used so the engine can spawn this Node.js process and
 * exchange MCP JSON-RPC messages over standard input/output.
 */
const server = new McpServer({
  name: "GeoStorm-SpaceData-Node",
  version: "1.0.0",
});

/**
 * Creates a successful MCP text response. API payloads are returned as
 * formatted JSON so downstream LLM/tool callers can inspect the raw source data.
 */
function toTextResponse(data: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Creates a standardized MCP tool error response without throwing across the
 * transport boundary. MCP clients can check `isError` while still receiving a
 * human-readable message in the normal content channel.
 */
function toErrorResponse(error: unknown): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: getErrorMessage(error),
      },
    ],
  };
}

/**
 * Normalizes unknown caught values into useful error messages, including
 * response bodies from failed HTTP calls when available.
 */
function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return formatAxiosError(error);
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unknown error occurred while processing the MCP tool request.";
}

function formatAxiosError(error: AxiosError): string {
  const status = error.response?.status;
  const statusText = error.response?.statusText;
  const responseBody = error.response?.data;
  const responseDetails =
    responseBody === undefined ? undefined : JSON.stringify(responseBody);

  return [
    "External API request failed.",
    status === undefined ? undefined : `Status: ${status}`,
    statusText ? `Status text: ${statusText}` : undefined,
    error.message ? `Message: ${error.message}` : undefined,
    responseDetails ? `Response: ${responseDetails}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Fetch coronal mass ejection records from NASA DONKI for the requested date
 * window. Dates are accepted as strings because NASA's API expects YYYY-MM-DD
 * query values and MCP input validation is handled through Zod.
 */
server.registerTool(
  "get_coronal_mass_ejections",
  {
    title: "Get Coronal Mass Ejections",
    description:
      "Fetch coronal mass ejection records from the NASA DONKI API for a start and end date.",
    inputSchema: {
      startDate: z
        .string()
        .min(1, "startDate is required")
        .describe("Inclusive start date in YYYY-MM-DD format."),
      endDate: z
        .string()
        .min(1, "endDate is required")
        .describe("Inclusive end date in YYYY-MM-DD format."),
    },
  },
  async ({ startDate, endDate }) => {
    try {
      const response = await axios.get<unknown>(NASA_DONKI_CME_URL, {
        params: {
          startDate,
          endDate,
          api_key: process.env.NASA_API_KEY || "DEMO_KEY",
        },
        timeout: REQUEST_TIMEOUT_MS,
      });

      return toTextResponse(response.data);
    } catch (error: unknown) {
      return toErrorResponse(error);
    }
  },
);

/**
 * Fetch recent NOAA SWPC space weather alerts. This endpoint returns the latest
 * alert product rows as JSON directly from NOAA's public services API.
 */
server.registerTool(
  "get_noaa_swpc_alerts",
  {
    title: "Get NOAA SWPC Alerts",
    description: "Fetch recent space weather alerts from the NOAA SWPC API.",
  },
  async () => {
    try {
      const response = await axios.get<unknown>(NOAA_SWPC_ALERTS_URL, {
        timeout: REQUEST_TIMEOUT_MS,
      });

      return toTextResponse(response.data);
    } catch (error: unknown) {
      return toErrorResponse(error);
    }
  },
);

/**
 * Start the MCP stdio transport. All diagnostic logging should go to stderr,
 * never stdout, because stdout is reserved for MCP protocol messages.
 */
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error(getErrorMessage(error));
  process.exitCode = 1;
});
