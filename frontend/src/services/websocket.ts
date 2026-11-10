import { getAuthToken, setAuthToken } from "./api";

type MessageHandler = (data: any) => void;
type BinaryHandler = (data: Blob) => void;

export class LessWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private onJson: MessageHandler | null = null;
  private onBinary: BinaryHandler | null = null;
  private reconnectTimer: number | null = null;
  private manuallyDisconnected = false;

  constructor(url = "ws://127.0.0.1:8000/ws") {
    this.url = url;
  }

  connect() {
    this.manuallyDisconnected = false;
    if (!getAuthToken()) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const socket = new WebSocket(this.url);
    this.ws = socket;
    socket.binaryType = "blob";

    socket.onopen = () => {
      if (this.ws !== socket) return;
      console.log("[WS] connected");
      const token = getAuthToken();
      if (!token) { this.ws?.close(4401, "Unauthorized"); return; }
      this.send(JSON.stringify({ type: "auth", token }));
    };

    socket.onmessage = (event) => {
      if (this.ws !== socket) return;
      if (event.data instanceof Blob) {
        this.onBinary?.(event.data);
      } else {
        try {
          const json = JSON.parse(event.data);
          if (json.type === "auth_ok") {
            this.send("start_stream");
            return;
          }
          this.onJson?.(json);
        } catch {
          // ignore
        }
      }
    };

    socket.onclose = (event) => {
      console.log("[WS] closed");
      if (this.ws !== socket || this.manuallyDisconnected) return;
      if (event.code === 4401) {
        setAuthToken(null);
        window.dispatchEvent(new Event("less:auth-expired"));
        return;
      }
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      if (this.ws === socket) socket.close();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  send(data: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  onMessage(handler: MessageHandler) {
    this.onJson = handler;
  }

  onFrame(handler: BinaryHandler) {
    this.onBinary = handler;
  }

  disconnect() {
    this.manuallyDisconnected = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.ws;
    this.ws = null;
    socket?.close();
  }
}

export const lessWs = new LessWebSocket();
