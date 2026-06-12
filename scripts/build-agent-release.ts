import { $ } from "bun";
import fs from "fs";
import path from "path";

const releaseDir = path.resolve("dist");
fs.mkdirSync(releaseDir, { recursive: true });

console.log("🤐 Zipping python automation scripts...");
const tempZip = path.resolve("dist/temp-assets.zip");
try {
  fs.unlinkSync(tempZip);
} catch {}

if (process.platform === "win32") {
  // On Windows, use PowerShell Compress-Archive
  await $`powershell -Command "Compress-Archive -Path 'scripts/auth/login.py', 'scripts/auth/requirements.txt', 'scripts/auth/app' -DestinationPath '${tempZip}' -Force"`;
} else {
  // On Linux/macOS, use zip
  await $`zip -r ${tempZip} scripts/auth/login.py scripts/auth/requirements.txt scripts/auth/app`;
}

console.log("📦 Encoding zip to base64...");
const zipBuffer = fs.readFileSync(tempZip);
const base64String = zipBuffer.toString("base64");

console.log("📝 Writing base64 data to src/agent-assets.ts...");
const assetFileContent = `export const pythonAssetsZipBase64 = "${base64String}";\n`;
fs.writeFileSync("src/agent-assets.ts", assetFileContent);

console.log("🔨 Compiling agent.ts to standalone Windows binary...");
const targetExe = path.join(releaseDir, "etteum-agent.exe");
await $`bun build src/agent.ts --compile --target=bun-windows-x64-baseline --outfile ${targetExe}`;

console.log("🧹 Cleaning up temporary files...");
try {
  fs.unlinkSync(tempZip);
} catch {}

// Restore placeholder in agent-assets.ts so git stays clean
fs.writeFileSync("src/agent-assets.ts", `export const pythonAssetsZipBase64 = "";\n`);

console.log(`🏁 Done! Single-file installer generated at: ${targetExe}`);
