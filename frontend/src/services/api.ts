import axios from "axios";

const api = axios.create({
  baseURL: "http://127.0.0.1:8000",
  timeout: 5000,
});

export interface SystemStatus {
  backend: string;
  camera: string;
  serial: string;
  db: string;
  ai: string;
  clients_ws: number;
}

export async function getStatus(): Promise<SystemStatus> {
  const { data } = await api.get<SystemStatus>("/api/status");
  return data;
}

export async function getLogs(limit = 50) {
  const { data } = await api.get("/api/logs", { params: { limit } });
  return data;
}

export async function getAlerts(limit = 20) {
  const { data } = await api.get("/api/alerts", { params: { limit } });
  return data;
}

export async function startCamera() {
  const { data } = await api.post("/api/camera/start");
  return data;
}

export async function stopCamera() {
  const { data } = await api.post("/api/camera/stop");
  return data;
}

export async function listSerialPorts() {
  const { data } = await api.get("/api/serial/ports");
  return data;
}

export async function runAiAnalyze() {
  const { data } = await api.post("/api/ai/analyze");
  return data;
}

export default api;
