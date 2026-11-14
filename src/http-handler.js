import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createSession, traceLine } from "./session.js";
import { runTurn } from "./loop.js";
import { listRefunds, resetStore } from "./tools.js";
import { llmTriageEnabled } from "./llm-triage.js";
import { signSession, readSession } from "./signing.js";
import { t, pickLang } from "./i18n.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = path.join(ROOT, "public");
const TRACE_DIR = path.join(ROOT, "traces", "live");
const MAX_BODY = 200_000; // a signed session carries the transcript and trace

// The server keeps no chats in memory. Each response carries the whole session as a
// signed token (src/signing.js) and the page sends it back with the next message.
// So any server instance can continue a chat, which matters on Vercel, where
// instances stop when idle and new ones start without the old memory.

// What the page gets back after every request: the signed session token, the state
// the trace drawer shows, the transcript and the trace.
function view(session) {
	return {
		token: signSession(session),
		sessionId: session.id,
		lang: session.lang,
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
function newSession(lang) {
	const session = createSession(pickLang(lang));

	traceLine(session, "new session (role Triage, verified false)");
	// Triage opens the chat with a greeting. Nothing else runs until the customer writes.
	session.messages.push({
		from: "agent",
		role: "triage",
		text: t(session).greeting(),
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
			const { lang } = await readJson(req);
			const session = newSession(lang);

			await saveTrace(session);

			return sendJson(res, 200, view(session));
		}

		// Reopen a chat after a page reload, from the token the page kept.
		if (req.method === "POST" && url.pathname === "/api/resume") {
			const { token } = await readJson(req);
			const session = readSession(token);

			if (!session) {
				return sendJson(res, 404, { error: "This chat has expired." });
			}

			return sendJson(res, 200, view(session));
		}

		// One customer message: run the agent loop for this session.
		if (req.method === "POST" && url.pathname === "/api/chat") {
			const { token, message, lang } = await readJson(req);
			const session = readSession(token);

			// A token that was changed, made by another deployment, or is a day old.
			if (!session) {
				return sendJson(res, 404, {
					error: "This chat has expired. Press New chat to start again.",
				});
			}

			// The customer switched language: agents reply in the new one from now on.
			if (lang) {
				session.lang = pickLang(lang);
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
