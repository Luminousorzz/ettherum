import path from "path";
import fs, { existsSync } from "fs";
import type { AgentJobResult } from "./ws";
import { pythonAssetsZipBase64 } from "./agent-assets";

const isWin = process.platform === "win32";
const dataDir = isWin 
  ? path.join(process.env.APPDATA || "C:\\temp", "etteum-agent") 
  : path.join(process.env.HOME || "/tmp", ".etteum-agent");

// Ensure data directory exists
fs.mkdirSync(dataDir, { recursive: true });

// 1. Sync python assets
if (pythonAssetsZipBase64) {
  const assetsZipPath = path.join(dataDir, "assets.zip");
  fs.writeFileSync(assetsZipPath, Buffer.from(pythonAssetsZipBase64, "base64"));
  
  console.log("[Agent] Syncing automation scripts...");
  if (isWin) {
    const extractCmd = `Expand-Archive -Path '${assetsZipPath}' -DestinationPath '${dataDir}' -Force`;
    await Bun.spawn(["powershell", "-Command", extractCmd]).exited;
  } else {
    await Bun.spawn(["unzip", "-o", assetsZipPath, "-d", dataDir]).exited;
  }
  
  try {
    fs.unlinkSync(assetsZipPath);
  } catch {}
}

// 2. Set up Startup/Boot Auto-Run if on Windows
const markerPath = path.join(dataDir, ".autorun-configured");
if (!existsSync(markerPath) && isWin) {
  const input = prompt("Do you want this agent to start automatically when Windows boots? [Y/n]:", "Y");
  const choice = (input || "Y").trim().toUpperCase();
  if (choice === "Y" || choice === "YES") {
    console.log("Setting up Windows Startup shortcut...");
    try {
      const shortcutPath = path.join(
        process.env.APPDATA || "",
        "Microsoft\\Windows\\Start Menu\\Programs\\Startup\\etteum-agent.lnk"
      );
      const exePath = process.execPath;
      const workingDir = path.dirname(exePath);
      const createShortcutCmd = `$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('${shortcutPath}'); $Shortcut.TargetPath = '${exePath}'; $Shortcut.WorkingDirectory = '${workingDir}'; $Shortcut.Save()`;
      await Bun.spawn(["powershell", "-Command", createShortcutCmd]).exited;
      console.log("Startup shortcut created successfully!");
    } catch (err) {
      console.error("Failed to create startup shortcut:", err);
    }
  }
  fs.writeFileSync(markerPath, "true");
}

// 3. Configure/Prompt Server WebSocket URL
let WS_URL = process.env.POOLPROX_WS_URL;
const envPath = path.join(dataDir, ".env");
if (!WS_URL && existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  const match = envContent.match(/POOLPROX_WS_URL=(.+)/);
  if (match) WS_URL = match[1].trim();
}
if (!WS_URL) {
  console.log("===================================================");
  console.log("  Etteum Local Runner Agent Setup");
  console.log("===================================================");
  console.log("");
  const input = prompt("Enter Server WebSocket URL [default: ws://localhost:1930/ws]:", "ws://localhost:1930/ws");
  WS_URL = input || "ws://localhost:1930/ws";
  fs.writeFileSync(envPath, `POOLPROX_WS_URL=${WS_URL}\n`);
}

const RECONNECT_DELAY = 3000;

// 4. Resolve Python paths
const venvDir = path.resolve(dataDir, "scripts/auth/.venv");
const localPythonPath = isWin
  ? path.join(venvDir, "Scripts/python.exe")
  : path.join(venvDir, "bin/python");

let systemPython = "";
try {
  const p = Bun.spawnSync([isWin ? "python" : "python3", "--version"]);
  if (p.success) {
    systemPython = isWin ? "python" : "python3";
  }
} catch {}

// 5. Python Installation check/winget setup
if (!existsSync(localPythonPath)) {
  if (!systemPython && isWin) {
    console.log("Python was not found in system PATH.");
    const input = prompt("Would you like to install Python 3.12 automatically via winget? [Y/n]:", "Y");
    const choice = (input || "Y").trim().toUpperCase();
    if (choice === "Y" || choice === "YES") {
      console.log("Installing Python via winget (this might open a User Account Control prompt)...");
      const proc = Bun.spawn([
        "winget", "install", "-e", "--id", "Python.Python.3.12", "--silent", "--accept-source-agreements", "--accept-package-agreements"
      ]);
      await proc.exited;
      
      // Re-verify python
      try {
        const p = Bun.spawnSync(["python", "--version"]);
        if (p.success) {
          systemPython = "python";
          console.log("Python installed successfully!");
        }
      } catch {}
    }
  }

  if (!systemPython) {
    console.error("Error: Python 3.10+ is required to run the agent.");
    console.error("Please install Python from https://www.python.org/downloads/ and add it to your PATH.");
    prompt("Press Enter to exit...");
    process.exit(1);
  }

  // Set up Virtualenv, dependencies, playwright, camoufox
  console.log("===================================================");
  console.log("  Setting up Python Virtual Environment & Browsers");
  console.log("  (This may take a few minutes...)");
  console.log("===================================================");
  
  const scriptsAuthDir = path.resolve(dataDir, "scripts/auth");
  
  console.log("[1/4] Creating virtual environment...");
  const venvProc = Bun.spawn([systemPython, "-m", "venv", ".venv"], { cwd: scriptsAuthDir, stdout: "inherit", stderr: "inherit" });
  await venvProc.exited;
  
  console.log("[2/4] Installing dependencies...");
  const pipPath = isWin ? path.join(venvDir, "Scripts/pip.exe") : path.join(venvDir, "bin/pip");
  const pipProc = Bun.spawn([pipPath, "install", "-r", "requirements.txt"], { cwd: scriptsAuthDir, stdout: "inherit", stderr: "inherit" });
  await pipProc.exited;
  
  console.log("[3/4] Installing browser binaries...");
  const playwrightPath = isWin ? path.join(venvDir, "Scripts/playwright.exe") : path.join(venvDir, "bin/playwright");
  const pwProc = Bun.spawn([playwrightPath, "install", "chromium"], { cwd: scriptsAuthDir, stdout: "inherit", stderr: "inherit" });
  await pwProc.exited;

  console.log("[4/4] Downloading Camoufox browser binaries...");
  const pyPath = isWin ? path.join(venvDir, "Scripts/python.exe") : path.join(venvDir, "bin/python");
  const cfProc = Bun.spawn([pyPath, "-m", "camoufox", "fetch"], { cwd: scriptsAuthDir, stdout: "inherit", stderr: "inherit" });
  await cfProc.exited;
  
  console.log("Setup completed successfully!");
}

const pythonPath = existsSync(localPythonPath) ? localPythonPath : systemPython;
const authScriptPath = path.resolve(dataDir, "scripts/auth/login.py");
const authScriptCwd = path.resolve(dataDir, "scripts/auth");
const defaultBrowserEngine = process.env.BROWSER_ENGINE || "camoufox";

console.log(`[Agent] Starting Windows Local Runner Agent...`);
console.log(`[Agent] Target Server WS URL: ${WS_URL}`);
console.log(`[Agent] Python Path: ${pythonPath}`);
console.log(`[Agent] Python Script: ${authScriptPath}`);

const activeProcesses = new Map<number, ReturnType<typeof Bun.spawn>>();
const sentResult = new Map<number, boolean>();

function connect() {
  const ws = new WebSocket(WS_URL);

  let pingInterval: Timer | null = null;

  ws.onopen = () => {
    console.log(`[Agent] Connected to pool-proxy server!`);
    
    // Register agent
    ws.send(
      JSON.stringify({
        type: "agent_register",
        data: {
          platform: process.platform,
          arch: process.arch,
        },
      })
    );

    // Keepalive ping every 30s
    pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);
  };

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data.toString());
      
      if (msg.type === "pong") {
        return;
      }

      if (msg.type === "run_login") {
        const job = msg.data as {
          accountId: number;
          email: string;
          passwordHex: string;
          provider: string;
          headless: boolean;
          browserEngine: string;
        };

        const { accountId, email, passwordHex, provider, headless, browserEngine } = job;
        console.log(`[Agent] Received job for Account ID ${accountId} (${provider}/${email})`);

        // If a process is already running for this account, kill it first
        if (activeProcesses.has(accountId)) {
          console.log(`[Agent] Job already running for Account ID ${accountId}. Killing old process...`);
          try {
            const oldProc = activeProcesses.get(accountId);
            oldProc?.kill("SIGKILL");
          } catch {}
          activeProcesses.delete(accountId);
        }

        sentResult.set(accountId, false);

        // Spawn login.py
        try {
          const runHeadless = headless ? "true" : "false";
          console.log(`[Agent] Spawning login.py with BATCHER_CAMOUFOX_HEADLESS=${runHeadless}`);

          const proc = Bun.spawn(
            [
              pythonPath,
              authScriptPath,
              "--email",
              email,
              "--password",
              passwordHex,
              "--account-id",
              String(accountId),
            ],
            {
              stdout: "pipe",
              stderr: "pipe",
              env: {
                ...process.env,
                ENOWX_ALLOWED_PROVIDERS: provider,
                PYTHONUNBUFFERED: "1",
                BATCHER_ENABLE_CAMOUFOX: "true",
                BATCHER_CAMOUFOX_HEADLESS: runHeadless,
                BATCHER_BROWSER_ENGINE: browserEngine || defaultBrowserEngine,
              },
              cwd: authScriptCwd,
            }
          );

          activeProcesses.set(accountId, proc);

          // Handle stdout stream
          const stdoutPromise = (async () => {
            const reader = proc.stdout.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                handleOutputLine(ws, accountId, provider, email, line);
              }
            }

            if (buffer.trim()) {
              handleOutputLine(ws, accountId, provider, email, buffer);
            }
          })();

          // Handle stderr stream (log errors)
          const stderrPromise = (async () => {
            const reader = proc.stderr.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) {
                  console.error(`[Agent Proc Stderr] [Account ${accountId}]: ${trimmed}`);
                }
              }
            }

            if (buffer.trim()) {
              console.error(`[Agent Proc Stderr] [Account ${accountId}]: ${buffer.trim()}`);
            }
          })();

          // Wait for process exit
          proc.exited.then(async (exitCode) => {
            await Promise.all([stdoutPromise, stderrPromise]);
            console.log(`[Agent] Process for Account ID ${accountId} exited with code ${exitCode}`);
            
            // If the script finished but never emitted the final 'result' block, send a failure result
            if (sentResult.get(accountId) === false) {
              ws.send(
                JSON.stringify({
                  type: "agent_result",
                  data: {
                    accountId,
                    success: false,
                    error: `Process exited with code ${exitCode} without returning final credentials.`,
                  },
                })
              );
            }

            activeProcesses.delete(accountId);
            sentResult.delete(accountId);
          });

        } catch (spawnError) {
          const errorMsg = spawnError instanceof Error ? spawnError.message : String(spawnError);
          console.error(`[Agent] Failed to spawn login process: ${errorMsg}`);
          ws.send(
            JSON.stringify({
              type: "agent_result",
              data: {
                accountId,
                success: false,
                error: `Failed to spawn process: ${errorMsg}`,
              },
            })
          );
          sentResult.delete(accountId);
        }
      }

      if (msg.type === "stop_login") {
        const payload = msg.data as { accountId: number };
        console.log(`[Agent] Received cancellation request for Account ID ${payload.accountId}`);
        const proc = activeProcesses.get(payload.accountId);
        if (proc) {
          try {
            proc.kill("SIGKILL");
            console.log(`[Agent] Sent SIGKILL to process for Account ID ${payload.accountId}`);
          } catch (e) {
            console.error(`[Agent] Error killing process: ${e}`);
          }
          activeProcesses.delete(payload.accountId);
        }
      }

    } catch (err) {
      console.error(`[Agent] Error processing message:`, err);
    }
  };

  ws.onclose = (e) => {
    console.log(`[Agent] Connection closed: ${e.reason || "No reason given"}. Reconnecting in ${RECONNECT_DELAY}ms...`);
    if (pingInterval) {
      clearInterval(pingInterval);
    }
    
    // Kill any running jobs when server disconnects
    for (const [accountId, proc] of activeProcesses.entries()) {
      try {
        proc.kill("SIGKILL");
      } catch {}
    }
    activeProcesses.clear();
    sentResult.clear();

    setTimeout(connect, RECONNECT_DELAY);
  };

  ws.onerror = (err) => {
    console.error(`[Agent] WebSocket error:`, err);
  };
}

function handleOutputLine(ws: WebSocket, accountId: number, provider: string, email: string, line: string) {
  const trimmed = line.trim();
  if (!trimmed) return;

  // Let's also print it to local agent console so user can see it
  console.log(`[Agent Proc Stdout] [Account ${accountId}]: ${trimmed}`);

  if (!trimmed.startsWith("{")) return;

  try {
    const event = JSON.parse(trimmed);
    
    if (event.type === "screenshot") {
      ws.send(
        JSON.stringify({
          type: "agent_screenshot",
          data: {
            accountId,
            provider: event.provider || provider,
            email: event.email || email,
            imageData: event.imageData,
          },
        })
      );
    } else if (event.type === "progress") {
      ws.send(
        JSON.stringify({
          type: "agent_progress",
          data: {
            id: accountId,
            accountId,
            email,
            provider: event.provider || provider,
            step: event.step,
            message: event.message,
            timestamp: new Date().toISOString(),
          },
        })
      );
    } else if (event.type === "error") {
      ws.send(
        JSON.stringify({
          type: "agent_progress",
          data: {
            id: accountId,
            accountId,
            email,
            provider: event.provider || provider,
            step: "error",
            message: event.error,
            timestamp: new Date().toISOString(),
          },
        })
      );
    } else if (event.type === "result") {
      const providerResult = event[provider];
      if (providerResult) {
        ws.send(
          JSON.stringify({
            type: "agent_result",
            data: {
              accountId,
              success: providerResult.success,
              tokens: providerResult.credentials,
              quota: providerResult.quota,
              error: providerResult.error,
              noRetry: providerResult.noRetry,
            },
          })
        );
        sentResult.set(accountId, true);
      }
    }
  } catch (e) {
    // Ignore JSON parse error for arbitrary print lines
  }
}

connect();
