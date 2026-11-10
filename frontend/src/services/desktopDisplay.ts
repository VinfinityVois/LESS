import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { availableMonitors, currentMonitor } from "@tauri-apps/api/window";

export async function openCameraOnExternalDisplay(): Promise<void> {
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
    await existing.setFocus();
    await existing.setFullscreen(true);
    return;
  }

  const display = new WebviewWindow("less-camera-display", {
    url: "/?display=camera",
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
