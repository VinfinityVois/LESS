type MessageHandler = (data: any) => void;
type BinaryHandler = (data: Blob) => void;

export class LessWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private jsonHandlers = new Set<MessageHandler>();
  private binaryHandlers = new Set<BinaryHandler>();
  private reconnectTimer: number | null = null;
  private intentionalClose = false;

  constructor(url = "ws://127.0.0.1:8000/ws") {
    this.url = url;
  }

  connect() {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.intentionalClose = false;
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "blob";

    this.ws.onopen = () => {
      console.log("[WS] connected");
      this.send("start_stream");
    };

    this.ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        this.binaryHandlers.forEach((h) => h(event.data));
      } else {
        try {
          const json = JSON.parse(event.data);
          this.jsonHandlers.forEach((h) => h(json));
        } catch {
          // ignore non-json text
        }
      }
    };

    this.ws.onclose = () => {
      console.log("[WS] closed");
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
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

  /** Register JSON handler; returns unsubscribe. */
  onMessage(handler: MessageHandler): () => void {
    this.jsonHandlers.add(handler);
    return () => this.jsonHandlers.delete(handler);
  }

  /** Register binary frame handler; returns unsubscribe. */
  onFrame(handler: BinaryHandler): () => void {
    this.binaryHandlers.add(handler);
    return () => this.binaryHandlers.delete(handler);
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.send("stop_stream");
      } catch {
        // ignore
      }
      this.ws.close();
      this.ws = null;
    }
  }
}

export const lessWs = new LessWebSocket();
