import path from "path";
import { existsSync } from "fs";
import type { AgentJobResult } from "./ws";

// Resolve paths relative to the executable's directory
const exeDir = path.dirname(process.execPath || Bun.main);

const WS_URL = process.env.POOLPROX_WS_URL || "ws://localhost:1930/ws";
const RECONNECT_DELAY = 3000;

// Search for local virtualenv python, otherwise fallback to system python
const localPythonPath = path.resolve(exeDir, "scripts/auth/.venv/Scripts/python.exe");
const pythonPath = existsSync(localPythonPath) 
  ? localPythonPath 
  : (process.platform === "win32" ? "python" : "python3");

const authScriptPath = path.resolve(exeDir, "scripts/auth/login.py");
const authScriptCwd = path.resolve(exeDir, "scripts/auth");
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
