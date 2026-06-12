import type { ServerWebSocket } from "bun";

interface WSMessage {
  type: string;
  data: unknown;
}

// Store connected WebSocket clients
const clients = new Set<ServerWebSocket<unknown>>();
const MAX_WS_PAYLOAD_BYTES = 256 * 1024; // Expanded for base64 screenshots

// Active agent WebSocket socket
let activeAgentWs: ServerWebSocket<unknown> | null = null;

// Callbacks for pending jobs delegated to the agent
export interface AgentJobResult {
  success: boolean;
  tokens?: Record<string, string>;
  quota?: Record<string, unknown>;
  error?: string;
  noRetry?: boolean;
}
export const pendingAgentJobs = new Map<number, (res: AgentJobResult) => void>();

/**
 * WebSocket handler for Bun.serve
 */
export const websocketHandler = {
  open(ws: ServerWebSocket<unknown>) {
    clients.add(ws);
    ws.send(
      JSON.stringify({
        type: "connected",
        data: { message: "Connected to pool-proxy WebSocket", clients: clients.size, agentConnected: activeAgentWs !== null },
      })
    );
    console.log(`[WS] Client connected (total: ${clients.size})`);
    
    // Send immediate agent status to new client
    ws.send(JSON.stringify({
      type: "agent_status",
      data: { connected: activeAgentWs !== null }
    }));
  },

  message(ws: ServerWebSocket<unknown>, message: string | Buffer) {
    try {
      const msg = JSON.parse(
        typeof message === "string" ? message : message.toString()
      ) as WSMessage;

      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", data: { timestamp: Date.now() } }));
        return;
      }

      // 1. Agent Registration Handshake
      if (msg.type === "agent_register") {
        activeAgentWs = ws;
        console.log("[WS] Windows Local Agent registered successfully!");
        ws.send(JSON.stringify({ type: "agent_registered", data: { success: true } }));
        broadcast({ type: "agent_status", data: { connected: true } });
        return;
      }

      // 2. Forward Agent progress logs to frontend clients
      if (msg.type === "agent_progress") {
        broadcast({ type: "login_progress", data: msg.data });
        return;
      }

      // 3. Forward Agent browser screenshots (Live Preview) to frontend clients
      if (msg.type === "agent_screenshot") {
        broadcast({ type: "live_screenshot", data: msg.data });
        return;
      }

      // 4. Resolve delegated job promise on agent results
      if (msg.type === "agent_result") {
        const payload = msg.data as { accountId: number; success: boolean; tokens?: Record<string, string>; quota?: Record<string, unknown>; error?: string; noRetry?: boolean };
        const resolve = pendingAgentJobs.get(payload.accountId);
        if (resolve) {
          resolve({
            success: payload.success,
            tokens: payload.tokens,
            quota: payload.quota,
            error: payload.error,
            noRetry: payload.noRetry
          });
          pendingAgentJobs.delete(payload.accountId);
        }
        return;
      }
    } catch (e) {
      // Ignore invalid messages
    }
  },

  close(ws: ServerWebSocket<unknown>) {
    clients.delete(ws);
    
    if (ws === activeAgentWs) {
      activeAgentWs = null;
      console.log("[WS] Windows Local Agent disconnected.");
      broadcast({ type: "agent_status", data: { connected: false } });
      
      // Cancel all pending agent jobs with error
      for (const [accountId, resolve] of pendingAgentJobs.entries()) {
        resolve({ success: false, error: "Agent disconnected during execution", noRetry: true });
      }
      pendingAgentJobs.clear();
    }
    
    console.log(`[WS] Client disconnected (total: ${clients.size})`);
  },

  drain(ws: ServerWebSocket<unknown>) {
    // Called when backpressure is relieved
  },
};

/**
 * Broadcast a message to all connected WebSocket clients (excluding the active agent)
 */
export function broadcast(message: WSMessage): void {
  if (clients.size === 0) return;

  let payload = JSON.stringify(message);
  if (payload.length > MAX_WS_PAYLOAD_BYTES) {
    payload = JSON.stringify({
      ...message,
      data: {
        ...(message.data && typeof message.data === "object" ? message.data as Record<string, unknown> : {}),
        requestBody: undefined,
        responseBody: undefined,
        truncated: true,
      },
    });
  }

  for (const client of clients) {
    // Don't send broadcast data back to the agent (it only listens for direct commands)
    if (client === activeAgentWs) continue;
    
    try {
      const sent = client.send(payload);
      if (sent === -1) {
        clients.delete(client);
        client.close();
      }
    } catch {
      clients.delete(client);
    }
  }
}

/**
 * Check if the Windows Agent is online
 */
export function isAgentConnected(): boolean {
  return activeAgentWs !== null;
}

/**
 * Delegate a login job to the Windows Agent
 */
export function delegateToAgent(accountId: number, job: {
  accountId: number;
  email: string;
  passwordHex: string; // decrypted/encrypted password
  provider: string;
  headless: boolean;
  browserEngine: string;
}): Promise<AgentJobResult> {
  if (!activeAgentWs) {
    return Promise.resolve({ success: false, error: "Agent not connected" });
  }

  return new Promise((resolve) => {
    pendingAgentJobs.set(accountId, resolve);
    activeAgentWs!.send(JSON.stringify({
      type: "run_login",
      data: job
    }));
  });
}

/**
 * Cancel a running job on the agent
 */
export function cancelAgentJob(accountId: number): void {
  if (activeAgentWs && pendingAgentJobs.has(accountId)) {
    activeAgentWs.send(JSON.stringify({
      type: "stop_login",
      data: { accountId }
    }));
  }
}

/**
 * Get the number of connected clients
 */
export function getClientCount(): number {
  return clients.size;
}
