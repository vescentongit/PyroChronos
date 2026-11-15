import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const url = "http://localhost:3000";
const isWin = process.platform === "win32";
const next = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));

const dev = spawn(process.execPath, [next, "dev", "--hostname", "0.0.0.0"], {
  stdio: ["inherit", "pipe", "inherit"],
});

let opened = false;
dev.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  if (!opened && chunk.toString().includes("Ready")) {
    opened = true;
    const cmd = isWin
      ? spawn("cmd", ["/c", "start", "chrome", url], { stdio: "ignore", detached: true })
      : spawn(process.platform === "darwin" ? "open" : "xdg-open", ["-a", "Google Chrome", url], { stdio: "ignore", detached: true });
    cmd.on("error", () => console.log(`Buka manual: ${url}`));
    cmd.unref();
  }
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => dev.kill(sig));
}
dev.on("exit", (code) => process.exit(code ?? 0));
