import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  buildSpaceWeatherContext,
  fetchCoronalMassEjections,
  fetchNoaaSwpcAlerts,
  getErrorMessage,
  normalizeDateWindow,
} from "./data.js";

dotenv.config();

const server = new McpServer({
  name: "GeoStorm-SpaceData-Node",
  version: "1.0.0",
});

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

server.registerTool(
  "get_coronal_mass_ejections",
  {
    title: "Get Coronal Mass Ejections",
    description:
      "Fetch coronal mass ejection records from the NASA DONKI API for a start and end date.",
    inputSchema: {
      startDate: z.string().min(1, "startDate is required"),
      endDate: z.string().min(1, "endDate is required"),
    },
  },
  async ({ startDate, endDate }) => {
    try {
      return toTextResponse(
        await fetchCoronalMassEjections(normalizeDateWindow(startDate, endDate)),
      );
    } catch (error: unknown) {
      return toErrorResponse(error);
    }
  },
);

server.registerTool(
  "get_noaa_swpc_alerts",
  {
    title: "Get NOAA SWPC Alerts",
    description: "Fetch recent space weather alerts from the NOAA SWPC API.",
  },
  async () => {
    try {
      return toTextResponse(await fetchNoaaSwpcAlerts());
    } catch (error: unknown) {
      return toErrorResponse(error);
    }
  },
);

server.registerTool(
  "get_space_weather_context",
  {
    title: "Get Space Weather Context",
    description: "Fetch normalized NASA DONKI and NOAA SWPC context.",
  },
  async () => {
    try {
      return toTextResponse(await buildSpaceWeatherContext());
    } catch (error: unknown) {
      return toErrorResponse(error);
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error(getErrorMessage(error));
  process.exitCode = 1;
});
