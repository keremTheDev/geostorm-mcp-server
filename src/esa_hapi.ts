import axios, { type AxiosError, type AxiosRequestConfig } from "axios";

export type EsaSourceStatus =
  | "disabled"
  | "ok"
  | "missing_configuration"
  | "missing_credentials"
  | "unavailable";

export type EsaHapiContext = {
  status: EsaSourceStatus;
  datasetId: string;
  data: unknown[];
  error: string;
};

type TokenResponse = {
  access_token?: string;
  token_type?: string;
};

const MAX_ESA_RECORDS = 50;
const ESA_REQUEST_TIMEOUT_MS = 30_000;

export async function fetchEsaHapiContext(): Promise<EsaHapiContext> {
  if (!isEnabled(process.env.ESA_ENABLED)) {
    return emptyEsaContext("disabled");
  }

  const baseUrl = normalizeBaseUrl(process.env.ESA_HAPI_BASE_URL);
  const datasetId = process.env.ESA_HAPI_DATASET_ID?.trim() || "";

  if (!baseUrl || !datasetId) {
    return {
      ...emptyEsaContext("missing_configuration"),
      datasetId,
      error: "ESA_ENABLED=true requires ESA_HAPI_BASE_URL and ESA_HAPI_DATASET_ID.",
    };
  }

  try {
    const token = await resolveAccessToken();
    const parameters = normalizeParameters(process.env.ESA_HAPI_PARAMETERS);
    const lookbackHours = normalizeLookbackHours(process.env.ESA_HAPI_LOOKBACK_HOURS);
    const stop = new Date();
    const start = new Date(stop);
    start.setUTCHours(stop.getUTCHours() - lookbackHours);

    const requestConfig: AxiosRequestConfig = {
      params: {
        id: datasetId,
        start: toHapiTimestamp(start),
        stop: toHapiTimestamp(stop),
        format: "json",
      },
      timeout: ESA_REQUEST_TIMEOUT_MS,
    };
    if (parameters.length) {
      requestConfig.params.parameters = parameters.join(",");
    }
    if (token) {
      requestConfig.headers = { Authorization: `Bearer ${token}` };
    }

    const response = await axios.get<unknown>(`${baseUrl}/data`, requestConfig);

    return {
      status: "ok",
      datasetId,
      data: compactHapiPayload(response.data),
      error: "",
    };
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    return {
      ...emptyEsaContext(isCredentialConfigurationError(message) ? "missing_credentials" : "unavailable"),
      datasetId,
      error: `ESA SWE HAPI unavailable: ${message}`,
    };
  }
}

function emptyEsaContext(status: EsaSourceStatus): EsaHapiContext {
  return {
    status,
    datasetId: "",
    data: [],
    error: "",
  };
}

function isEnabled(value?: string): boolean {
  return ["1", "true", "yes", "on"].includes((value || "").trim().toLowerCase());
}

function normalizeBaseUrl(value?: string): string {
  return (value || "").trim().replace(/\/+$/, "");
}

function normalizeParameters(value?: string): string[] {
  return (value || "")
    .split(",")
    .map((parameter) => parameter.trim())
    .filter(Boolean);
}

function normalizeLookbackHours(value?: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 24;
  return Math.min(Math.max(parsed, 1), 168);
}

function toHapiTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function resolveAccessToken(): Promise<string | undefined> {
  const staticToken = process.env.ESA_ACCESS_TOKEN?.trim();
  if (staticToken) return staticToken;

  const tokenUrl = process.env.ESA_TOKEN_URL?.trim();
  const clientId = process.env.ESA_CLIENT_ID?.trim();
  const clientSecret = process.env.ESA_CLIENT_SECRET?.trim();

  const authValues = [tokenUrl, clientId, clientSecret].filter(Boolean);
  if (!authValues.length) return undefined;
  if (authValues.length !== 3) {
    throw new Error(
      "missing_credentials: ESA OAuth requires ESA_TOKEN_URL, ESA_CLIENT_ID, and ESA_CLIENT_SECRET.",
    );
  }

  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId || "",
    client_secret: clientSecret || "",
  });

  const response = await axios.post<TokenResponse>(tokenUrl || "", form, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: ESA_REQUEST_TIMEOUT_MS,
  });

  if (!response.data.access_token) {
    throw new Error("missing_credentials: ESA token endpoint did not return access_token.");
  }

  return response.data.access_token;
}

function compactHapiPayload(payload: unknown): unknown[] {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const data = record.data;
    if (Array.isArray(data)) {
      return data.slice(-MAX_ESA_RECORDS);
    }
  }

  if (Array.isArray(payload)) {
    return payload.slice(-MAX_ESA_RECORDS);
  }

  return payload === undefined || payload === null ? [] : [payload];
}

function isCredentialConfigurationError(message: string): boolean {
  return message.toLowerCase().includes("missing_credentials");
}

function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return formatAxiosError(error);
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unknown ESA SWE HAPI request error occurred.";
}

function formatAxiosError(error: AxiosError): string {
  const status = error.response?.status;
  const statusText = error.response?.statusText;
  const responseBody = error.response?.data;

  return [
    "External ESA HAPI request failed.",
    status === undefined ? undefined : `Status: ${status}`,
    statusText ? `Status text: ${statusText}` : undefined,
    error.message ? `Message: ${error.message}` : undefined,
    responseBody === undefined ? undefined : `Response: ${JSON.stringify(responseBody)}`,
  ]
    .filter(Boolean)
    .join(" ");
}
