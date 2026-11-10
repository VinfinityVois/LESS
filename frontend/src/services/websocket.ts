type MessageHandler = (data: any) => void;
type BinaryHandler = (data: Blob) => void;

export class LessWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private onJson: MessageHandler | null = null;
  private onBinary: BinaryHandler | null = null;
  private reconnectTimer: number | null = null;

  constructor(url = "ws://127.0.0.1:8000/ws") {
    this.url = url;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "blob";

    this.ws.onopen = () => {
      console.log("[WS] connected");
      this.send("start_stream");
    };

    this.ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        this.onBinary?.(event.data);
      } else {
        try {
          const json = JSON.parse(event.data);
          this.onJson?.(json);
        } catch {
          // ignore
        }
      }
    };

    this.ws.onclose = () => {
      console.log("[WS] closed, reconnect in 2s");
      this.scheduleReconnect();
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

  onMessage(handler: MessageHandler) {
    this.onJson = handler;
  }

  onFrame(handler: BinaryHandler) {
    this.onBinary = handler;
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}

export const lessWs = new LessWebSocket();
