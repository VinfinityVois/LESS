import axios from "axios";

let authToken: string | null = null;
const authChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("less-auth-session") : null;

authChannel?.addEventListener("message", (event: MessageEvent<{ type?: string; token?: string }>) => {
  if (event.data?.type === "request-token" && authToken) {
    authChannel?.postMessage({ type: "shared-token", token: authToken });
  } else if (event.data?.type === "shared-token" && typeof event.data.token === "string") {
    authToken = event.data.token;
  } else if (event.data?.type === "clear-token") {
    authToken = null;
  }
});

export function setAuthToken(token: string | null) {
  authToken = token;
  authChannel?.postMessage({ type: token ? "shared-token" : "clear-token", token });
}
export function getAuthToken() { return authToken; }

export function waitForSharedAuthToken(timeoutMs = 5000): Promise<string | null> {
  if (authToken) return Promise.resolve(authToken);
  if (!authChannel) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      authChannel.removeEventListener("message", receive);
      window.clearTimeout(timer);
      resolve(token);
    };
    const receive = (event: MessageEvent<{ type?: string; token?: string }>) => {
      if (event.data?.type === "shared-token" && typeof event.data.token === "string") {
        authToken = event.data.token;
        finish(event.data.token);
      }
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    authChannel.addEventListener("message", receive);
    authChannel.postMessage({ type: "request-token" });
  });
}

const api = axios.create({
  baseURL: "http://127.0.0.1:8000",
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  if (authToken) config.headers.Authorization = `Bearer ${authToken}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const path = String(error?.config?.url || "");
    if (error?.response?.status === 401 && !path.includes("/api/auth/login") && !path.includes("/api/auth/bootstrap")) {
      setAuthToken(null);
      window.dispatchEvent(new Event("less:auth-expired"));
    }
    return Promise.reject(error);
  }
);

export interface AdminAccount {
  id: number;
  username: string;
  display_name: string;
  role: "superadmin" | "admin" | "security";
  is_active: boolean;
  created_at: string;
}

export interface AuthResult {
  access_token: string;
  token_type: "bearer";
  expires_at: string;
  user: AdminAccount;
}

export async function getBootstrapStatus() {
  const { data } = await api.get<{ initialized: boolean; admin_count: number }>("/api/auth/bootstrap-status");
  return data;
}
export async function bootstrapAdmin(body: { username: string; display_name: string; password: string }) {
  const { data } = await api.post<AuthResult>("/api/auth/bootstrap", body);
  setAuthToken(data.access_token);
  return data;
}
export async function loginAdmin(body: { username: string; password: string; remember_me?: boolean }) {
  const { data } = await api.post<AuthResult>("/api/auth/login", body);
  setAuthToken(data.access_token);
  return data;
}
export async function getCurrentAdmin() {
  const { data } = await api.get<AdminAccount>("/api/auth/me");
  return data;
}
export async function logoutAdmin() {
  try { await api.post("/api/auth/logout"); } finally { setAuthToken(null); }
}
export async function listAdminAccounts() {
  const { data } = await api.get<{ admins: AdminAccount[] }>("/api/auth/admins");
  return data.admins;
}
export async function createAdminAccount(body: { username: string; display_name: string; password: string; role: "admin" | "security" }) {
  const { data } = await api.post<AdminAccount>("/api/auth/admins", body);
  return data;
}
export async function setAdminAccountActive(id: number, is_active: boolean) {
  const { data } = await api.patch(`/api/auth/admins/${id}`, { is_active });
  return data;
}
export async function getAdminAudit(limit = 100) {
  const { data } = await api.get("/api/auth/audit", { params: { limit } });
  return data;
}

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
  profile_photo_data_url?: string | null;
  is_active: number;
  face_enrolled?: number;
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;
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

export interface LogDay { day: string; events: number; granted: number; denied: number }
export interface DailyLogEvent extends AccessLog {
  user_name?: string | null;
  first_peak_at?: string | null;
  repeat_peak_at?: string | null;
  attempts?: number;
}
export async function getLogDays() {
  const { data } = await api.get<{ days: LogDay[] }>("/api/logs/days");
  return data.days;
}
export async function getLogDay(day: string) {
  const { data } = await api.get<{ day: string; events: DailyLogEvent[]; raw_events: DailyLogEvent[] }>(`/api/logs/day/${day}`);
  return data;
}
export async function exportLogs(day?: string) {
  const { data } = await api.get<Blob>("/api/logs/export", { params: day ? { day } : {}, responseType: "blob" });
  return data;
}
export async function recognizeMonitoringFace(frame: string) {
  const { data } = await api.post<{ status: "identified" | "unknown" | "ambiguous"; similarity?: number | null; subject?: { id: number; name: string; position?: string; photo_data_url?: string | null } | null; note?: string }>("/api/biometrics/recognize", { frame }, { timeout: 12000 });
  return data;
}

export async function getAlerts(limit = 20) {
  const { data } = await api.get("/api/alerts", { params: { limit } });
  return data;
}

export async function getHardwareStatus() {
  const { data } = await api.get("/api/hardware/status");
  return data as {
    configured: boolean; authenticated: boolean; serial_connected: boolean;
    controller_id?: string | null; lock_state: string; door_state: string;
    last_seen?: string | null; alarm?: string | null;
  };
}

export async function verifySecurityAudit() {
  const { data } = await api.get("/api/security/audit/verify");
  return data as { valid: boolean; records: number; head?: string; error?: string };
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

export async function createLivenessChallenge(userId: number, consentConfirmed: boolean, purpose: "face_enrollment" | "pad_testing" = "face_enrollment") {
  const { data } = await api.post("/api/biometrics/liveness/challenge", { user_id: userId, consent_confirmed: consentConfirmed, purpose });
  return data as { challenge_id: string; actions: string[]; instructions: Record<string, string>; expires_at: string };
}
export async function verifyLiveness(body: { user_id: number; challenge_id: string; evidence: { action: string; frames: string[] }[] }) {
  const { data } = await api.post("/api/biometrics/liveness/verify", body);
  return data as { verified: boolean; proof_token: string; assurance: string; warning: string };
}
export async function faceEnroll(userId: number, body: { front_landmarks: number[][]; profile_landmarks: number[][]; front_photo: string; profile_photo: string; liveness_proof: string }) {
  const { data } = await api.post(`/api/users/${userId}/face-enroll`, body);
  return data;
}

export async function simulateTestCard(body: { label?: string; door_id?: string; direction?: "in" | "out" }) {
  const { data } = await api.post("/api/access/test-card", body);
  return data as { success: boolean; simulation: boolean; event_id: number; message: string };
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

export async function readSerialCardLine() {
  const { data } = await api.get<{ line: string | null }>("/api/serial/read");
  return data.line;
}

export interface FaceAccessChallenge {
  nfc_uid?: string;
  challenge_id: string;
  actions: string[];
  instructions: Record<string, string>;
  user: { id: number; name: string; position: string; photo_data_url?: string | null };
  door_id: string;
  direction: string;
}

export async function createFaceAccessChallenge(body: { nfc_uid: string; door_id?: string; direction?: string }) {
  const { data } = await api.post<FaceAccessChallenge>("/api/access/face-challenge", body);
  return data;
}

export async function checkFaceAccess(body: {
  nfc_uid: string; challenge_id: string; door_id?: string; direction?: string;
  evidence: { action: string; frames: string[] }[];
}) {
  const { data } = await api.post("/api/access/check-face", body, { timeout: 90000 });
  return data as {
    decision: "allow" | "deny"; code: string; reason: string; similarity?: number;
    liveness?: string; event_id?: number;
    hardware?: { confirmed: boolean; lock_state: string; door_state: string };
    subject?: { id: number; name: string; position: string; photo_data_url?: string | null };
  };
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


export interface GuestPass {
  id: number; code_prefix: string; label: string; expires_at: string; max_uses: number;
  uses: number; door_ids: string[]; status: "active" | "closed" | "blocked"; active: boolean; created_at: string;
}
export async function listGuestPasses() {
  const { data } = await api.get<{ codes: GuestPass[] }>("/api/access/guest-codes");
  return data.codes;
}
export async function updateGuestPass(id: number, action: "close" | "block" | "restore" | "reset" | "extend", hours = 2) {
  const { data } = await api.patch("/api/access/guest-codes/" + id, { action, hours });
  return data;
}
export async function deleteGuestPass(id: number) {
  const { data } = await api.delete("/api/access/guest-codes/" + id);
  return data;
}

export async function listDoors() {
  const { data } = await api.get("/api/access/doors");
  return data;
}

export default api;

export interface SecurityIncident {
  id: number;
  dedupe_key: string;
  subject_ref?: string | null;
  title: string;
  summary: string;
  severity: "low" | "medium" | "high" | "critical";
  risk_score: number;
  evidence: {
    event_ids?: number[];
    doors?: string[];
    factors?: { code: string; points: number; count?: number; doors?: string[]; model?: string }[];
    risk_scale?: string;
    ml_model?: string | null;
    ml_model_version?: string | null;
    subject_label?: string;
  };
  first_seen: string;
  last_seen: string;
  occurrences: number;
  status: "open" | "resolved" | "dismissed";
}

export async function analyzeSecurityIncidents() {
  const { data } = await api.post<{ ml_status?: string; generated: number; incidents: SecurityIncident[] }>("/api/ai/incidents/analyze");
  return data;
}
export async function getSecurityIncidents(status?: "open" | "resolved" | "dismissed") {
  const { data } = await api.get<{ incidents: SecurityIncident[] }>("/api/ai/incidents", { params: { limit: 200, status } });
  return data.incidents;
}
export async function getLocalAIAssistantStatus() {
  const { data } = await api.get<{ enabled: boolean; available: boolean; model?: string; message?: string }>("/api/ai/assistant/status");
  return data;
}
export async function explainSecurityIncident(incidentId: number, question = "") {
  const { data } = await api.post<{ status: string; answer?: string; model?: string; message?: string; disclaimer?: string }>("/api/ai/assistant/explain", {
    incident_id: incidentId, question,
  }, { timeout: 30000 });
  return data;
}

export async function updateSecurityIncidentStatus(incidentId: number, status: "open" | "resolved" | "dismissed") {
  const { data } = await api.patch<SecurityIncident>(`/api/ai/incidents/${incidentId}`, { status });
  return data;
}

export async function recordPadTrial(body: { trial_class: "bona_fide" | "attack"; attack_type?: string; accepted: boolean; failure_reason?: string; test_condition?: string; camera_label?: string }) {
  const { data } = await api.post<{ id: number; recorded: boolean }>("/api/biometrics/liveness/evaluation-trials", body);
  return data;
}
export async function getPadEvaluationReport() {
  const { data } = await api.get<{ status: string; report?: {
    counts: { total: number; bona_fide: number; attacks: number };
    apcer: number; apcer_wilson_95: [number, number]; bpcer: number; bpcer_wilson_95: [number, number]; acer: number;
    attack_species: Record<string, { presentations: number; false_accepts: number; apcer: number }>;
    by_condition: Record<string, { trials: number; bona_fide: number; attacks: number; apcer: number | null; bpcer: number | null }>;
    by_camera: Record<string, { trials: number; bona_fide: number; attacks: number; apcer: number | null; bpcer: number | null }>;
    warning: string;
  }; counts?: { total: number }; message?: string }>("/api/biometrics/liveness/evaluation-report");
  return data;
}

export async function getFingerprintReaderStatus() {
  const { data } = await api.get<{ available: boolean; device_id?: string | null; vendor?: string | null; message: string }>("/api/biometrics/fingerprint/status");
  return data;
}
