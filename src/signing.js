// Signing helpers. Two separate keys:
//   SESSION_SECRET  signs the whole session sent to the browser, so the browser can
//                   carry the chat between server instances but cannot edit it.
//   TOOL_SECRET     signs the receipt verify_identity writes. Only the tools layer
//                   uses it, so an agent that sets session.verified by itself still
//                   has no valid receipt.
//
// On Vercel both come from environment variables. Locally, if they are not set, each
// server process makes random ones (a restart then ends open chats, like before).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_SECRET = process.env.SESSION_SECRET || randomBytes(32).toString("hex");
const TOOL_SECRET = process.env.TOOL_SECRET || randomBytes(32).toString("hex");

// A chat token older than this is refused, and the page starts a new chat.
const MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000;

function hmac(secret, text) {
	return createHmac("sha256", secret).update(text).digest("base64url");
}

// Compare two signatures without leaking where they differ.
function sameSignature(a, b) {
	const x = Buffer.from(String(a));
	const y = Buffer.from(String(b));

	return x.length === y.length && timingSafeEqual(x, y);
}

// Session -> "<base64url json>.<signature>"
export function signSession(session) {
	const body = Buffer.from(JSON.stringify(session)).toString("base64url");

	return `${body}.${hmac(SESSION_SECRET, body)}`;
}

// "<base64url json>.<signature>" -> session, or null if the token was changed or is too old.
export function readSession(token) {
	if (typeof token !== "string" || !token.includes(".")) {
		return null;
	}

	const [body, signature] = token.split(".");

	if (!sameSignature(signature, hmac(SESSION_SECRET, body))) {
		return null;
	}

	try {
		const session = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));

		if (Date.now() - session.createdAt > MAX_SESSION_AGE_MS) {
			return null;
		}

		return session;
	} catch {
		return null;
	}
}

// The receipt verify_identity writes after a correct code, bound to one session id.
export function verificationReceipt(sessionId) {
	return hmac(TOOL_SECRET, `verified:${sessionId}`);
}

// True only if the receipt was made by verify_identity for this exact session.
export function hasValidReceipt(session) {
	return (
		typeof session.verificationReceipt === "string" &&
		sameSignature(session.verificationReceipt, verificationReceipt(session.id))
	);
}
