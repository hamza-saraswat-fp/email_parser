// AgentMail WebSocket listener. Copied from the FieldPulse support agent
// (src/email/listener.ts, IAI-496 shape) and trimmed: one subscribe list from
// PARSER_INBOX_IDS, and every inbound goes to the pipeline via routeInbound().
//
// Why WebSocket and not a webhook: push delivery with no public URL, so the
// same code runs on a laptop and on Railway.
import { AgentMailClient } from "agentmail";
import { config } from "../config.js";
import type { InboundEmail } from "../pipeline/types.js";

const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
// The process can be offline for a while (paused service, incident); a tight
// window silently drops emails that arrived just outside it.
const CATCHUP_LOOKBACK_MS = 48 * 60 * 60 * 1000;

type AmSocket = Awaited<ReturnType<AgentMailClient["websockets"]["connect"]>>;

// Dual-reads camel/snake: the socket and REST transports are different
// serializations of the same message. Trust the wire, not the .d.ts.
export function toInboundEmail(msg: any, fallbackInboxId?: string): InboundEmail {
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v : []);
  const from: string = msg.from_ ?? msg.from ?? "";
  const m = from.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  const from_email = (m ? m[2] : from).trim().toLowerCase() || null;
  const from_name = m ? m[1].trim() || null : null;
  return {
    message_id: msg.messageId ?? msg.message_id,
    inbox_id: msg.inboxId ?? msg.inbox_id ?? fallbackInboxId ?? "",
    from_email,
    from_name,
    to: arr(msg.to),
    subject: msg.subject ?? null,
    text: msg.text ?? null,
    html: msg.html ?? null,
    attachments: arr(msg.attachments).map((a: any) => ({
      attachment_id: a.attachmentId ?? a.attachment_id ?? null,
      filename: a.filename ?? null,
      size: a.size ?? null,
      content_type: a.contentType ?? a.content_type ?? null,
    })),
    received_at: new Date(msg.timestamp ?? msg.createdAt ?? msg.created_at ?? Date.now()).toISOString(),
  };
}

export type RouteInbound = (email: InboundEmail) => Promise<void>;

export async function startListener(routeInbound: RouteInbound, emailExists: (messageId: string) => Promise<boolean>): Promise<void> {
  const inboxIds = config.PARSER_INBOX_IDS;
  let reconnectDelay = RECONNECT_DELAY_MS;
  let lastConnectedAt: Date | null = null;
  // Single-flight reconnect. Stacked reconnect chains once rate-limited the
  // support agent's egress IP; we own reconnects and disable the SDK's.
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnecting = false;
  let isSubscribed = false;
  let currentSocket: AmSocket | null = null;

  async function catchUpMissedEmails(client: AgentMailClient): Promise<void> {
    const after = lastConnectedAt
      ? new Date(lastConnectedAt.getTime() - 30_000)
      : new Date(Date.now() - CATCHUP_LOOKBACK_MS);
    console.log(`[CATCHUP] Checking for missed emails since ${after.toISOString()}`);
    for (const inboxId of inboxIds) {
      await catchUpInbox(client, inboxId, after);
    }
  }

  async function catchUpInbox(client: AgentMailClient, inboxId: string, after: Date): Promise<void> {
    const inboxLocalPart = inboxId.split("@")[0].toLowerCase();
    try {
      const response = await client.inboxes.messages.list(inboxId, { after, limit: 50, ascending: true });
      const summaries = (response as any).body?.messages ?? (response as any).messages ?? [];
      let caught = 0;
      for (const summary of summaries) {
        const msgId = summary.messageId;
        if (!msgId) continue;
        if (await emailExists(msgId)) continue;
        let fullMsg: any;
        try {
          fullMsg = await client.inboxes.messages.get(summary.inboxId ?? inboxId, msgId);
        } catch (err) {
          console.error(`[CATCHUP] Failed to fetch full message ${msgId}:`, err);
          continue;
        }
        const fromField: string = fullMsg.from_ ?? fullMsg.from ?? "";
        const toField: string[] = Array.isArray(fullMsg.to) ? fullMsg.to : [];
        const isOutbound = (toField.length > 0 && !fromField.includes("@")) || fromField.toLowerCase().includes(inboxLocalPart);
        if (isOutbound) continue;
        console.log(`[CATCHUP] Found missed email: "${fullMsg.subject}" from ${fromField}`);
        caught++;
        try {
          await routeInbound(toInboundEmail(fullMsg, inboxId));
        } catch (err) {
          console.error(`[CATCHUP] Error processing missed email ${msgId}:`, err);
        }
      }
      console.log(`[CATCHUP] ${inboxId}: ${caught} missed email(s) recovered, ${summaries.length} total checked`);
    } catch (err) {
      console.error(`[CATCHUP] Failed to fetch missed emails for ${inboxId}:`, err);
    }
  }

  async function connect(): Promise<void> {
    if (currentSocket) {
      try { currentSocket.close(); } catch { /* not-yet-open socket */ }
      currentSocket = null;
    }
    isSubscribed = false;

    const client = new AgentMailClient({ apiKey: config.AGENTMAIL_API_KEY });
    console.log("[WS] Connecting to AgentMail WebSocket...");
    const socket = await client.websockets.connect({ reconnectAttempts: 0 });
    currentSocket = socket;

    socket.on("message", async (event: any) => {
      if (event.type === "subscribed") {
        console.log("[WS] Subscribed to inbox(es):", inboxIds.join(", "));
        reconnectDelay = RECONNECT_DELAY_MS;
        isSubscribed = true;
        await catchUpMissedEmails(client);
        lastConnectedAt = new Date();
        return;
      }
      if (event.type === "event" && event.eventType === "message.received") {
        const msg = event.message;
        console.log(`[WS] New email from ${msg.from_ ?? msg.from}: "${msg.subject}"`);
        try {
          // Re-read over REST: the socket payload can arrive without a body.
          const messageId = msg.messageId ?? msg.message_id;
          const inboxId = msg.inboxId ?? msg.inbox_id;
          let source: any = msg;
          try {
            source = await client.inboxes.messages.get(inboxId, messageId);
          } catch (err) {
            console.error(`[WS] Refetch failed for ${messageId}; using the socket payload:`, err);
          }
          await routeInbound(toInboundEmail(source, inboxId));
        } catch (err) {
          console.error("[WS] Error processing email:", err);
        }
        return;
      }
      if (event.type === "error") console.error("[WS] Error event:", event);
    });

    socket.on("close", (event: any) => {
      console.log(`[WS] Disconnected: code=${event?.code ?? "?"} reason=${event?.reason ?? ""}`);
      isSubscribed = false;
      scheduleReconnect();
    });
    socket.on("error", (error: any) => {
      console.error(`[WS] Connection error: message=${error?.message ?? "?"} code=${error?.code ?? "?"}`);
    });

    await socket.waitForOpen();
    console.log("[WS] Connected");
    socket.sendSubscribe({ type: "subscribe" as const, inboxIds });
  }

  function scheduleReconnect(): void {
    if (reconnecting || reconnectTimer) return;
    if (isSubscribed) return;
    reconnecting = true;
    console.log(`[WS] Reconnecting in ${reconnectDelay / 1000}s...`);
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      let chainAnother = false;
      try {
        await connect();
      } catch (err) {
        console.error("[WS] Reconnect failed:", err instanceof Error ? err.message : String(err));
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
        chainAnother = true;
      } finally {
        reconnecting = false;
      }
      if (chainAnother) scheduleReconnect();
    }, reconnectDelay);
  }

  try {
    await connect();
  } catch (err) {
    console.error("[WS] Initial connect failed:", err instanceof Error ? err.message : String(err));
    scheduleReconnect();
  }
}
