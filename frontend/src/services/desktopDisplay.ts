import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

export async function openCameraOnExternalDisplay(): Promise<void> {
  const current = getCurrentWindow();
  const monitors = await current.availableMonitors();
  if (monitors.length < 2) {
    throw new Error("Подключённый дополнительный монитор не обнаружен.");
  }
  const active = await current.currentMonitor();
  const target = monitors.find((monitor) => monitor.name !== active?.name) ?? monitors[1];
  const existing = await WebviewWindow.getByLabel("less-camera-display");
  if (existing) {
    await existing.setFocus();
    await existing.setFullscreen(true);
    return;
  }

  const display = new WebviewWindow("less-camera-display", {
    url: "/?display=camera",
    title: "LESS — Видеонаблюдение",
    x: target.position.x,
    y: target.position.y,
    width: target.size.width,
    height: target.size.height,
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
