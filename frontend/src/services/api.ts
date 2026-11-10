import axios from "axios";

const api = axios.create({
  baseURL: "http://127.0.0.1:8000",
  timeout: 8000,
});

export interface SystemStatus {
  backend: string;
  camera: string;
  serial: string;
  db: string;
  ai: string;
  clients_ws: number;
}

export interface User {
  id: number;
  nfc_uid: string;
  name: string;
  position?: string;
  photo_available?: boolean;
  photo_data_url?: string | null;
  is_active: number;
  face_enrolled?: number;
  created_at: string;
  updated_at?: string;
  last_entry?: string | null;
  last_exit?: string | null;
  total_events?: number;
  logs?: AccessLog[];
}

export interface AccessLog {
  id: number;
  nfc_uid?: string;
  user_id?: number;
  event_type: string;
  factor_used?: string;
  reason?: string;
  direction?: string;
  door_id?: string;
  created_at: string;
}

export async function getStatus(): Promise<SystemStatus> {
  const { data } = await api.get<SystemStatus>("/api/status");
  return data;
}

export async function getLogs(limit = 50) {
  const { data } = await api.get("/api/logs", { params: { limit } });
  return data as AccessLog[];
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

export async function listUsers(includeInactive = true) {
  const { data } = await api.get<{ users: User[] }>("/api/users", {
    params: { include_inactive: includeInactive },
  });
  return data.users;
}

export async function getUser(id: number) {
  const { data } = await api.get<User>(`/api/users/${id}`);
  return data;
}

export async function createUser(body: {
  nfc_uid: string;
  name?: string;
  position?: string;
  pin?: string;
  is_active?: boolean;
  photo_data_url?: string;
}) {
  const { data } = await api.post("/api/users", body);
  return data;
}

export async function updateUser(
  id: number,
  body: Partial<{ name: string; position: string; nfc_uid: string; pin: string; is_active: boolean; photo_data_url: string }>
) {
  const { data } = await api.patch(`/api/users/${id}`, body);
  return data;
}

export async function deleteUser(id: number, hard = false) {
  const { data } = await api.delete(`/api/users/${id}`, { params: { hard } });
  return data;
}

export async function faceEnroll(userId: number, body: { front_landmarks: number[][]; profile_landmarks: number[][]; front_photo: string; profile_photo: string }) {
  const { data } = await api.post(`/api/users/${userId}/face-enroll`, body);
  return data;
}

export async function accessCheck(body: {
  nfc_uid?: string;
  user_id?: number;
  door_id?: string;
  direction?: string;
  guest_code?: string;
  factor?: string;
}) {
  const { data } = await api.post("/api/access/check", body);
  return data;
}

export async function createGuestCode(body: {
  label?: string;
  valid_hours?: number;
  max_uses?: number;
  door_ids?: string[];
}) {
  const { data } = await api.post("/api/access/guest-codes", body);
  return data;
}

export async function listDoors() {
  const { data } = await api.get("/api/access/doors");
  return data;
}

export default api;
