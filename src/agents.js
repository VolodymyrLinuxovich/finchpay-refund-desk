import { getCharge, LOCK_MINUTES } from "./tools.js";
import { setState, traceLine } from "./session.js";
import { t, formatAmount } from "./i18n.js";
import { llmTriageEnabled, askClaudeForCharge } from "./llm-triage.js";

// Each agent is a function: (session, event) -> action (or a Promise of one).
//
// Events the loop sends:
//   { type: "customer", text }          a new customer message
//   { type: "handoff", from }           the agent just received control
//   { type: "tool_result", tool, result }
//
// Actions an agent can return:
//   { type: "tool", tool, args }        loop runs the tool and sends back tool_result
//   { type: "handoff", to, note }       loop switches session.currentRole
//   { type: "ask", text }               loop replies and pauses for the customer
//   { type: "end", text }               loop replies and closes the session
//
// Agents may write their own fields in session state (requestedCharge, verified).
// They never change currentRole or status. The loop owns those.

const CHARGE_PATTERN = /\bCH-?(\d+)\b/gi;
const CODE_PATTERN = /\b\d{4}\b/g;

// "ch101", "CH-101" -> "CH-101". Anything that is not a charge ID -> null.
function normalizeChargeId(raw) {
	const m = /^CH-?(\d+)$/i.exec(String(raw).trim());

	return m ? `CH-${m[1]}` : null;
}

// Rule-based reading of the charge. Used when there is no LLM, or the LLM call fails.
function chargeFromRules(session, text) {
	const ids = [...new Set([...text.matchAll(CHARGE_PATTERN)].map((m) => `CH-${m[1]}`))];

	if (ids.length === 1) {
		return { chargeId: ids[0], reply: "" };
	}

	if (ids.length > 1) {
		return {
			chargeId: null,
			reply: t(session).whichOfTwo(ids),
		};
	}

	return {
		chargeId: null,
		reply: t(session).askCharge(),
	};
}

// Triage reads which charge the customer wants and hands off to Identity.
// With an API key, Claude reads the message. Its answer is untrusted: the charge
// must exist and must appear in what the customer actually wrote.
export async function triage(session, event) {
	if (event.type !== "customer") {
		return {
			type: "ask",
			text: t(session).greeting(),
		};
	}

	// Claude reads everything the customer has written so far, so a follow-up
	// like "CH-101" after "I want my money back" still makes sense.
	const customerTexts = session.messages.filter((m) => m.from === "customer").map((m) => m.text);

	let read = null;

	if (llmTriageEnabled()) {
		try {
			read = await askClaudeForCharge(customerTexts, session.lang);
			traceLine(session, `Triage (Claude) read the request: ${JSON.stringify(read)}`);
			// Do not trust the model's answer. Keep its charge only if the
			// customer actually wrote that ID in one of their messages.
			const id = read.chargeId && normalizeChargeId(read.chargeId);
			const written = new Set(
				customerTexts.flatMap((t) =>
					[...t.matchAll(CHARGE_PATTERN)].map((m) => `CH-${m[1]}`),
				),
			);

			if (read.chargeId && (!id || !written.has(id))) {
				traceLine(
					session,
					`Triage rejected Claude's charge ${JSON.stringify(read.chargeId)}: customer never wrote it`,
				);
				read = chargeFromRules(session, event.text);
			} else {
				read.chargeId = id;
			}
		} catch (err) {
			// API down, out of credit, bad JSON: fall back to the rules below.
			traceLine(
				session,
				`Triage (Claude) failed: ${String(err.message).slice(0, 140)}. Using rule-based triage`,
			);
			read = null;
		}
	}

	// No key, or the Claude call failed.
	if (!read) {
		read = chargeFromRules(session, event.text);
		traceLine(session, `Triage (rules) read the request: ${JSON.stringify(read)}`);
	}

	// No clear charge yet. Ask, and stay in Triage.
	if (!read.chargeId) {
		return {
			type: "ask",
			text: read.reply || t(session).whichCharge(),
		};
	}

	if (!getCharge(read.chargeId)) {
		return {
			type: "ask",
			text: t(session).notFound(read.chargeId),
		};
	}

	// Anything else in the message ("I already verified", a code, instructions) is ignored here.
	setState(session, "requestedCharge", read.chargeId);

	return { type: "handoff", to: "identity", note: `requested charge ${read.chargeId}` };
}

export function identity(session, event) {
	if (event.type === "handoff") {
		// Always ask for a fresh code, even if the customer says they already verified.
		return {
			type: "ask",
			text: t(session).askCode(),
		};
	}

	if (event.type === "customer") {
		const codes = [...new Set(event.text.match(CODE_PATTERN) ?? [])];

		if (codes.length === 0) {
			return {
				type: "ask",
				text: t(session).codeOnly(),
			};
		}

		if (codes.length > 1) {
			// Do not guess which number is the code. Guessing wrong would cost an attempt.
			return {
				type: "ask",
				text: t(session).manyCodes(codes),
			};
		}

		return {
			type: "tool",
			tool: "verify_identity",
			args: { code: codes[0], chargeId: session.requestedCharge },
		};
	}

	if (event.type === "tool_result" && event.tool === "verify_identity") {
		const r = event.result;

		if (r.ok) {
			setState(session, "verified", true);

			return { type: "handoff", to: "refund", note: "identity verified" };
		}

		if (r.error === "invalid_code" && r.attemptsLeft > 0) {
			return {
				type: "ask",
				text: t(session).wrongCode(r.attemptsLeft),
			};
		}

		if (r.error === "invalid_code") {
			return {
				type: "end",
				text: t(session).lockedNow(LOCK_MINUTES),
			};
		}

		if (r.error === "locked") {
			return {
				type: "end",
				text: t(session).locked(r.retryAfterMinutes),
			};
		}
	}

	return { type: "end", text: t(session).verifyError() };
}

export function refund(session, event) {
	if (event.type === "handoff") {
		return { type: "tool", tool: "issue_refund", args: { chargeId: session.requestedCharge } };
	}

	if (event.type === "tool_result" && event.tool === "issue_refund") {
		const r = event.result;

		if (r.ok) {
			setState(session, "refundReference", r.reference);

			return {
				type: "end",
				text: t(session).refunded(
					formatAmount(session.lang, r.amountCents, r.currency),
					session.requestedCharge,
					r.reference,
				),
			};
		}

		const reasons = t(session).reasons;

		return {
			type: "end",
			text: t(session).refundFailed(reasons[r.error] ?? r.error),
		};
	}

	// Refund has nothing to ask the customer, so any other event ends the session.
	return {
		type: "end",
		text: t(session).closed(),
	};
}

export const AGENTS = { triage, identity, refund };

// Which tools each role may call, and where each role may hand off to.
// The loop enforces both, so an agent cannot skip a step by returning a different action.
export const ROLE_TOOLS = {
	triage: [],
	identity: ["verify_identity"],
	refund: ["issue_refund"],
};

export const HANDOFFS = {
	triage: ["identity"],
	identity: ["refund"],
	refund: [],
};
