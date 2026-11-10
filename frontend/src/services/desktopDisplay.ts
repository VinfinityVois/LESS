import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { availableMonitors, currentMonitor } from "@tauri-apps/api/window";

export async function openCameraOnExternalDisplay(mode: "video" | "events" = "video"): Promise<void> {
  const monitors = await availableMonitors();
  if (monitors.length < 2) {
    throw new Error("Подключённый дополнительный монитор не обнаружен.");
  }
  const active = await currentMonitor();
  const target = monitors.find((monitor) => monitor.name !== active?.name) ?? monitors[1];
  const position = target.position.toLogical(target.scaleFactor);
  const size = target.size.toLogical(target.scaleFactor);
  const existing = await WebviewWindow.getByLabel("less-camera-display");
  if (existing) {
    const channel = new BroadcastChannel("less-external-display");
    channel.postMessage({ type: "set-mode", mode });
    window.setTimeout(() => channel.close(), 250);
    await existing.setFocus();
    await existing.setFullscreen(true);
    return;
  }

  const display = new WebviewWindow("less-camera-display", {
    url: "/?display=camera&mode=" + mode,
    title: "LESS — Видеонаблюдение",
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
    fullscreen: true,
    decorations: false,
    resizable: true,
    focus: true,
  });

  await new Promise<void>((resolve, reject) => {
    void display.once("tauri://created", () => resolve());
    void display.once("tauri://error", (event) => reject(new Error(String(event.payload || "Не удалось открыть окно камеры."))));
  });
}

export async function closeExternalDisplay(): Promise<void> {
  const display = await WebviewWindow.getByLabel("less-camera-display");
  if (display) await display.close();
}
