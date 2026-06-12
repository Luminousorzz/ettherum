import { $ } from "bun";
import fs from "fs";
import path from "path";

const releaseDir = path.resolve("dist/etteum-agent");
const scriptsAuthDir = path.resolve("dist/etteum-agent/scripts/auth");

// 1. Clean previous release
fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(scriptsAuthDir, { recursive: true });

// 2. Compile agent.ts
console.log("🔨 Compiling agent.ts to standalone binary...");
await $`bun build src/agent.ts --compile --outfile ${releaseDir}/etteum-agent.exe`;

// 3. Copy scripts/auth files
console.log("📂 Copying scripts/auth python files...");
fs.copyFileSync("scripts/auth/login.py", `${scriptsAuthDir}/login.py`);
fs.copyFileSync("scripts/auth/requirements.txt", `${scriptsAuthDir}/requirements.txt`);

// Helper function to recursively copy directories
function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".venv" || entry.name === "__pycache__") continue;
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDir("scripts/auth/app", `${scriptsAuthDir}/app`);

// 4. Create setup.bat
console.log("📝 Writing setup.bat...");
const setupBat = `@echo off
echo ===================================================
echo   Etteum Local Runner Agent - Setup Wizard
echo ===================================================
echo.
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in system PATH!
    echo Please install Python 3.10+ (check "Add Python to PATH")
    echo and run this setup again.
    pause
    exit /b 1
)
echo [1/3] Creating Python Virtual Environment...
cd scripts\\auth
python -m venv .venv
if %errorlevel% neq 0 (
    echo [ERROR] Failed to create virtual environment!
    pause
    exit /b 1
)
echo [2/3] Installing dependencies...
call .venv\\Scripts\\activate
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install python packages!
    pause
    exit /b 1
)
echo [3/3] Installing browser binaries...
playwright install chromium
python -m camoufox fetch
echo.
echo ===================================================
echo   Setup completed successfully!
echo   Double-click run.bat to start the agent.
echo ===================================================
pause`;
fs.writeFileSync(`${releaseDir}/setup.bat`, setupBat);

// 5. Create run.bat
console.log("📝 Writing run.bat...");
const runBat = `@echo off
echo ===================================================
echo   Etteum Local Runner Agent
echo ===================================================
echo.
if not exist .env (
    set /p WS_URL="Enter Server WebSocket URL [default: ws://localhost:1930/ws]: "
    if "%WS_URL%"=="" set WS_URL=ws://localhost:1930/ws
    echo POOLPROX_WS_URL=%WS_URL% > .env
)
for /f "usebackq tokens=1,2 delims==" %%a in (.env) do (
    if "%%a"=="POOLPROX_WS_URL" set POOLPROX_WS_URL=%%b
)
echo Target Server: %POOLPROX_WS_URL%
echo.
etteum-agent.exe
pause`;
fs.writeFileSync(`${releaseDir}/run.bat`, runBat);

// 6. Zip everything up
console.log("📦 Zipping release...");
if (process.platform === "win32") {
  await $`powershell -Command "Compress-Archive -Path '${releaseDir}' -DestinationPath 'dist/etteum-agent.zip' -Force"`;
} else {
  await $`zip -r dist/etteum-agent.zip dist/etteum-agent`;
}

console.log("🏁 Done! Release generated at: dist/etteum-agent.zip");
