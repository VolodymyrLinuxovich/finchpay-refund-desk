import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createSession, traceLine } from "./session.js";
import { runTurn } from "./loop.js";
import { listRefunds } from "./tools.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = path.join(ROOT, "public");
const TRACE_DIR = path.join(ROOT, "traces", "live");
const PORT = Number(process.env.PORT ?? 3000);
const MAX_BODY = 10_000;

// Sessions live in server memory. The browser only holds the session id.
const sessions = new Map();

function view(session) {
  return {
    sessionId: session.id,
    state: {
      currentRole: session.currentRole,
      status: session.status,
      requestedCharge: session.requestedCharge,
      verified: session.verified,
      verifyAttempts: session.verifyAttempts,
      refundReference: session.refundReference,
      totalSteps: session.totalSteps,
    },
    messages: session.messages,
    trace: session.trace,
  };
}

// Write each session's trace to traces/live/<id>.log after every turn.
async function saveTrace(session) {
  await mkdir(TRACE_DIR, { recursive: true });
  await writeFile(path.join(TRACE_DIR, `${session.id}.log`), session.trace.join("\n") + "\n");
}

function newSession() {
  const session = createSession();
  sessions.set(session.id, session);
  traceLine(session, "new session (role Triage, verified false)");
  // Triage opens the chat with a greeting. Nothing else runs until the customer writes.
  session.messages.push({
    from: "agent",
    role: "triage",
    text: "Hi, this is the FinchPay refund desk. Which charge would you like refunded?",
  });
  session.status = "waiting";
  traceLine(session, "Triage greets the customer, waiting for customer");
  return session;
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await readFile(path.join(PUBLIC_DIR, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    if (req.method === "POST" && url.pathname === "/api/session") {
      const session = newSession();
      await saveTrace(session);
      return sendJson(res, 200, view(session));
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const { sessionId, message } = await readJson(req);
      const session = sessions.get(sessionId);
      if (!session) return sendJson(res, 404, { error: "Unknown session. Start a new chat." });
      runTurn(session, typeof message === "string" ? message.slice(0, 2000) : "");
      await saveTrace(session);
      return sendJson(res, 200, view(session));
    }

    if (req.method === "GET" && url.pathname === "/api/refunds") {
      return sendJson(res, 200, { refunds: listRefunds() });
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    sendJson(res, 400, { error: "Bad request" });
  }
});

server.listen(PORT, () => {
  console.log(`FinchPay refund desk running at http://localhost:${PORT}`);
});
