import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createSession, traceLine } from "./session.js";
import { runTurn } from "./loop.js";
import { listRefunds, resetStore } from "./tools.js";
import { llmTriageEnabled } from "./llm-triage.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = path.join(ROOT, "public");
const TRACE_DIR = path.join(ROOT, "traces", "live");
const MAX_BODY = 10_000;
const MAX_SESSIONS = 1000;

// Sessions live in server memory. The browser only holds the session id.
const sessions = new Map();

// What the page gets back after every request: the session id, the state the
// side panel shows, the transcript and the trace. Never the tool-owned records.
function view(session) {
	return {
		sessionId: session.id,
		state: {
			currentRole: session.currentRole,
			status: session.status,
			requestedCharge: session.requestedCharge,
			verified: session.verified,
			refundReference: session.refundReference,
			totalSteps: session.totalSteps,
			triageMode: llmTriageEnabled() ? "claude" : "rules",
		},
		messages: session.messages,
		trace: session.trace,
	};
}

// Locally, write each session's trace to traces/live/<id>.log after every turn.
// Skipped on Vercel, where the filesystem is read only.
async function saveTrace(session) {
	if (process.env.VERCEL) {
		return;
	}

	await mkdir(TRACE_DIR, { recursive: true });
	await writeFile(path.join(TRACE_DIR, `${session.id}.log`), session.trace.join("\n") + "\n");
}

// Start a fresh, unverified session. Triage greets the customer, then the
// session waits for the first message.
function newSession() {
	if (sessions.size >= MAX_SESSIONS) {
		sessions.delete(sessions.keys().next().value);
	}

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

// Send a JSON response. no-store so a browser never shows an old chat.
function sendJson(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	res.end(JSON.stringify(body));
}

// Read a JSON body, with a size cap so one request cannot fill memory.
async function readJson(req) {
	// Some hosts (Vercel) parse the body before we see it.
	if (req.body && typeof req.body === "object") {
		return req.body;
	}

	let raw = "";

	for await (const chunk of req) {
		raw += chunk;

		if (raw.length > MAX_BODY) {
			throw new Error("body too large");
		}
	}

	return raw ? JSON.parse(raw) : {};
}

// Every route of the app. Used by the local server and by Vercel.
export async function handler(req, res) {
	try {
		const url = new URL(req.url, "http://localhost");

		// The chat page.
		if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
			const html = await readFile(path.join(PUBLIC_DIR, "index.html"));

			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });

			return res.end(html);
		}

		// The page script.
		if (req.method === "GET" && url.pathname === "/app.js") {
			const js = await readFile(path.join(PUBLIC_DIR, "app.js"));

			res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });

			return res.end(js);
		}

		// New chat: a fresh, unverified session.
		if (req.method === "POST" && url.pathname === "/api/session") {
			const session = newSession();

			await saveTrace(session);

			return sendJson(res, 200, view(session));
		}

		// One customer message: run the agent loop for this session.
		if (req.method === "POST" && url.pathname === "/api/chat") {
			const { sessionId, message } = await readJson(req);
			const session = sessions.get(sessionId);

			if (!session) {
				return sendJson(res, 404, {
					error: "This chat has expired. Press New chat to start again.",
				});
			}

			// Only plain text, at most 2000 characters, reaches the agents.
			await runTurn(session, typeof message === "string" ? message.slice(0, 2000) : "");
			await saveTrace(session);

			return sendJson(res, 200, view(session));
		}

		// Demo helper: clears mock refunds and lockouts so the next reviewer starts clean.
		// Sessions stay, but none of them can refund until they verify again.
		if (req.method === "POST" && url.pathname === "/api/reset-demo") {
			resetStore();
			console.log("demo data reset: refunds and lockouts cleared");

			return sendJson(res, 200, { ok: true });
		}

		if (req.method === "GET" && url.pathname === "/api/refunds") {
			return sendJson(res, 200, { refunds: listRefunds() });
		}

		sendJson(res, 404, { error: "Not found" });
	} catch (err) {
		console.error(err);
		sendJson(res, 400, { error: "Bad request" });
	}
}
