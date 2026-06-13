import axios, { AxiosError } from "axios";

import { fetchEsaHapiContext, type EsaSourceStatus } from "./esa_hapi.js";

export const NASA_DONKI_CME_URL = "https://api.nasa.gov/DONKI/CME";
export const NOAA_SWPC_ALERTS_URL =
  "https://services.swpc.noaa.gov/products/alerts.json";
export const REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_CME_LOOKBACK_DAYS = 7;

export type RiskLevel =
  | "G0"
  | "G1"
  | "G2"
  | "G3"
  | "G4"
  | "G5"
  | "CRITICAL"
  | "UNKNOWN";

export type DateWindow = {
  startDate: string;
  endDate: string;
};

export type SpaceWeatherContext = {
  source: "geostorm-mcp-server";
  fetched_at: string;
  date_window: DateWindow;
  noaa_swpc_alerts: unknown[];
  nasa_donki_cmes: unknown[];
  esa_source_status: EsaSourceStatus;
  esa_data_json: string;
  esa_dataset_id: string;
  esa_error: string;
  risk_signals: {
    has_noaa_alerts: boolean;
    cme_count: number;
    highest_detected_level: RiskLevel;
  };
  errors: string[];
};

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return formatAxiosError(error);
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unknown error occurred while processing the space-weather request.";
}

export function defaultDateWindow(): DateWindow {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCDate(endDate.getUTCDate() - DEFAULT_CME_LOOKBACK_DAYS);

  return {
    startDate: toDateOnly(startDate),
    endDate: toDateOnly(endDate),
  };
}

export function normalizeDateWindow(
  startDate?: string | null,
  endDate?: string | null,
): DateWindow {
  const defaults = defaultDateWindow();

  return {
    startDate: isDateOnly(startDate) ? startDate : defaults.startDate,
    endDate: isDateOnly(endDate) ? endDate : defaults.endDate,
  };
}

export async function fetchCoronalMassEjections(
  window: DateWindow,
): Promise<unknown[]> {
  const response = await axios.get<unknown>(NASA_DONKI_CME_URL, {
    params: {
      startDate: window.startDate,
      endDate: window.endDate,
      api_key: process.env.NASA_API_KEY || "DEMO_KEY",
    },
    timeout: REQUEST_TIMEOUT_MS,
  });

  return normalizeArrayPayload(response.data);
}

export async function fetchNoaaSwpcAlerts(): Promise<unknown[]> {
  const response = await axios.get<unknown>(NOAA_SWPC_ALERTS_URL, {
    timeout: REQUEST_TIMEOUT_MS,
  });

  return normalizeArrayPayload(response.data);
}

export async function buildSpaceWeatherContext(
  requestedWindow: DateWindow = defaultDateWindow(),
): Promise<SpaceWeatherContext> {
  const errors: string[] = [];
  let noaaAlerts: unknown[] = [];
  let cmeRecords: unknown[] = [];
  let esaSourceStatus: EsaSourceStatus = "disabled";
  let esaDataJson = "[]";
  let esaDatasetId = "";
  let esaError = "";

  const [noaaResult, cmeResult, esaResult] = await Promise.allSettled([
    fetchNoaaSwpcAlerts(),
    fetchCoronalMassEjections(requestedWindow),
    fetchEsaHapiContext(),
  ]);

  if (noaaResult.status === "fulfilled") {
    noaaAlerts = noaaResult.value;
  } else {
    errors.push(`NOAA SWPC alerts unavailable: ${getErrorMessage(noaaResult.reason)}`);
  }

  if (cmeResult.status === "fulfilled") {
    cmeRecords = cmeResult.value;
  } else {
    errors.push(`NASA DONKI CMEs unavailable: ${getErrorMessage(cmeResult.reason)}`);
  }

  if (esaResult.status === "fulfilled") {
    esaSourceStatus = esaResult.value.status;
    esaDataJson = JSON.stringify(esaResult.value.data);
    esaDatasetId = esaResult.value.datasetId;
    esaError = esaResult.value.error;
    if (esaError && esaSourceStatus !== "disabled") {
      errors.push(esaError);
    }
  } else {
    esaSourceStatus = "unavailable";
    esaError = `ESA SWE HAPI unavailable: ${getErrorMessage(esaResult.reason)}`;
    errors.push(esaError);
  }

  return {
    source: "geostorm-mcp-server",
    fetched_at: new Date().toISOString(),
    date_window: requestedWindow,
    noaa_swpc_alerts: noaaAlerts,
    nasa_donki_cmes: cmeRecords,
    esa_source_status: esaSourceStatus,
    esa_data_json: esaDataJson,
    esa_dataset_id: esaDatasetId,
    esa_error: esaError,
    risk_signals: {
      has_noaa_alerts: noaaAlerts.length > 0,
      cme_count: cmeRecords.length,
      highest_detected_level: detectHighestRiskLevel(noaaAlerts, cmeRecords),
    },
    errors,
  };
}

export function detectHighestRiskLevel(...payloads: unknown[]): RiskLevel {
  const haystack = JSON.stringify(payloads).toUpperCase();
  if (haystack.includes("CRITICAL") || haystack.includes("EXTREME")) return "CRITICAL";

  const matches = [...haystack.matchAll(/\bG([0-5])\b/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);

  if (!matches.length) return "UNKNOWN";

  return `G${Math.max(...matches)}` as RiskLevel;
}

function normalizeArrayPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload === null || payload === undefined) return [];
  return [payload];
}

function isDateOnly(value?: string | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toDateOnly(date: Date): string {
  const isoDate = date.toISOString().split("T")[0];
  return isoDate || new Date().toISOString().split("T")[0] || "1970-01-01";
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
