import dotenv from "dotenv";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import path from "path";

import "./http_server.js";
import {
  buildSpaceWeatherContext,
  fetchCoronalMassEjections,
  fetchNoaaSwpcAlerts,
  getErrorMessage,
  normalizeDateWindow,
} from "./data.js";

dotenv.config();

const SERVICE_NAME = "geostorm-mcp-server";
const GRPC_HOST = process.env.GRPC_HOST || "0.0.0.0";
const GRPC_PORT = Number(process.env.GRPC_PORT || "50051");
const PROTO_PATH =
  process.env.SPACE_WEATHER_PROTO_PATH ||
  path.resolve(process.cwd(), "proto", "space_weather.proto");

type GrpcCallback<T> = (error: grpc.ServiceError | null, response?: T) => void;

type DateWindowRequest = {
  start_date?: string;
  end_date?: string;
};

type RawJsonResponse = {
  source: string;
  fetched_at: string;
  raw_json: string;
  errors: string[];
};

type SpaceWeatherContextResponse = {
  source: string;
  fetched_at: string;
  date_window: {
    start_date: string;
    end_date: string;
  };
  noaa_swpc_alerts_json: string;
  nasa_donki_cmes_json: string;
  risk_signals_json: string;
  errors: string[];
  esa_source_status: string;
  esa_data_json: string;
  esa_dataset_id: string;
  esa_error: string;
};

type HealthResponse = {
  status: string;
  service: string;
  message: string;
};

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const grpcObject = grpc.loadPackageDefinition(packageDefinition) as Record<string, unknown>;
const spaceWeatherPackage = (((grpcObject.geostorm as Record<string, unknown>)
  .spaceweather as Record<string, unknown>).v1 || {}) as Record<string, unknown>;
const serviceDefinition = (
  spaceWeatherPackage.SpaceWeatherService as { service: grpc.ServiceDefinition }
).service;

const implementation = {
  Health(
    _call: grpc.ServerUnaryCall<Record<string, never>, HealthResponse>,
    callback: GrpcCallback<HealthResponse>,
  ): void {
    callback(null, {
      status: "ok",
      service: SERVICE_NAME,
      message: "gRPC server is alive",
    });
  },

  Ready(
    _call: grpc.ServerUnaryCall<Record<string, never>, HealthResponse>,
    callback: GrpcCallback<HealthResponse>,
  ): void {
    callback(null, {
      status: "ready",
      service: SERVICE_NAME,
      message: "gRPC server is ready; external NASA/NOAA calls are checked per request",
    });
  },

  async GetNoaaSwpcAlerts(
    _call: grpc.ServerUnaryCall<Record<string, never>, RawJsonResponse>,
    callback: GrpcCallback<RawJsonResponse>,
  ): Promise<void> {
    const fetchedAt = new Date().toISOString();
    try {
      const alerts = await fetchNoaaSwpcAlerts();
      callback(null, {
        source: SERVICE_NAME,
        fetched_at: fetchedAt,
        raw_json: JSON.stringify(alerts),
        errors: [],
      });
    } catch (error: unknown) {
      callback(null, {
        source: SERVICE_NAME,
        fetched_at: fetchedAt,
        raw_json: "[]",
        errors: [`NOAA SWPC alerts unavailable: ${getErrorMessage(error)}`],
      });
    }
  },

  async GetNasaDonkiCmes(
    call: grpc.ServerUnaryCall<DateWindowRequest, RawJsonResponse>,
    callback: GrpcCallback<RawJsonResponse>,
  ): Promise<void> {
    const fetchedAt = new Date().toISOString();
    const window = normalizeDateWindow(call.request.start_date, call.request.end_date);

    try {
      const cmes = await fetchCoronalMassEjections(window);
      callback(null, {
        source: SERVICE_NAME,
        fetched_at: fetchedAt,
        raw_json: JSON.stringify(cmes),
        errors: [],
      });
    } catch (error: unknown) {
      callback(null, {
        source: SERVICE_NAME,
        fetched_at: fetchedAt,
        raw_json: "[]",
        errors: [`NASA DONKI CMEs unavailable: ${getErrorMessage(error)}`],
      });
    }
  },

  async GetContext(
    call: grpc.ServerUnaryCall<DateWindowRequest, SpaceWeatherContextResponse>,
    callback: GrpcCallback<SpaceWeatherContextResponse>,
  ): Promise<void> {
    const window = normalizeDateWindow(call.request.start_date, call.request.end_date);
    const context = await buildSpaceWeatherContext(window);

    callback(null, {
      source: context.source,
      fetched_at: context.fetched_at,
      date_window: {
        start_date: context.date_window.startDate,
        end_date: context.date_window.endDate,
      },
      noaa_swpc_alerts_json: JSON.stringify(context.noaa_swpc_alerts),
      nasa_donki_cmes_json: JSON.stringify(context.nasa_donki_cmes),
      risk_signals_json: JSON.stringify(context.risk_signals),
      errors: context.errors,
      esa_source_status: context.esa_source_status,
      esa_data_json: context.esa_data_json,
      esa_dataset_id: context.esa_dataset_id,
      esa_error: context.esa_error,
    });
  },
};

const server = new grpc.Server();
server.addService(serviceDefinition, implementation);

server.bindAsync(
  `${GRPC_HOST}:${GRPC_PORT}`,
  grpc.ServerCredentials.createInsecure(),
  (error: Error | null, port: number) => {
    if (error) {
      console.error(`Failed to start ${SERVICE_NAME} gRPC server: ${error.message}`);
      process.exitCode = 1;
      return;
    }

    console.error(`${SERVICE_NAME} gRPC service listening on ${GRPC_HOST}:${port}`);
  },
);
