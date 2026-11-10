import { cp, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const destination = join(root, "public", "mediapipe", "wasm");

try {
  await access(source);
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
  console.log("[LESS] MediaPipe WASM copied to public/mediapipe/wasm");
} catch (error) {
  console.error("[LESS] MediaPipe WASM assets are missing. Run npm ci in frontend/.", error);
  process.exitCode = 1;
}
