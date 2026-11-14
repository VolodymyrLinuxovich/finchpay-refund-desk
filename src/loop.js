// The agent loop. One call to runTurn handles one customer message:
// it asks the current agent what to do, does it, and repeats until the
// agent waits for the customer, the chat ends, or a step limit is hit.
//
// The loop is also a guard. It only runs tools the current role owns
// (ROLE_TOOLS) and only allows forward handoffs (HANDOFFS), so an agent
// cannot skip Identity by returning a different action.

import { AGENTS, ROLE_TOOLS, HANDOFFS } from "./agents.js";
import { TOOLS } from "./tools.js";
import { traceLine } from "./session.js";
import { t } from "./i18n.js";

// Steps allowed while handling one customer message. A normal turn uses at most 4.
export const MAX_STEPS_PER_TURN = 8;
// Steps allowed over the whole conversation, so a customer cannot keep it going forever.
export const MAX_STEPS_PER_SESSION = 40;

const ROLE_NAMES = { triage: "Triage", identity: "Identity", refund: "Refund" };
const name = (role) => ROLE_NAMES[role] ?? role;

// Add an agent message to the transcript, tagged with the role that sent it.
function reply(session, text) {
	session.messages.push({ from: "agent", role: session.currentRole, text });
}

// Send a final message and close the session. Nothing runs after this.
function endSession(session, text, why) {
	reply(session, text);
	session.status = "ended";
	traceLine(session, `${name(session.currentRole)} replies: ${JSON.stringify(text)}`);
	traceLine(session, `session ended (${why})`);
}

// Handle one customer message. Runs agent steps until an agent asks the customer
// something (pause), ends the session (stop), or a step limit is hit (stop).
export async function runTurn(session, customerText) {
	const text = String(customerText ?? "").trim();

	// An ended chat stays ended. The customer has to press New chat.
	if (session.status === "ended") {
		traceLine(session, "customer wrote after the session ended, nothing runs");

		return session;
	}

	if (!text) {
		return session;
	}

	session.messages.push({ from: "customer", text });
	session.status = "active";
	traceLine(session, `customer: ${JSON.stringify(text)}`);

	// The first event of a turn is always the customer's message.
	// After that, each step's result becomes the next event.
	let event = { type: "customer", text };

	for (let step = 0; step < MAX_STEPS_PER_TURN; step++) {
		if (session.totalSteps >= MAX_STEPS_PER_SESSION) {
			endSession(session, t(session).tooLong(), "session step limit reached");

			return session;
		}

		session.totalSteps++;

		// Ask the current agent for its next action.
		const role = session.currentRole;
		const action = await AGENTS[role](session, event);

		switch (action.type) {
			// The agent wants a tool. Check the role owns it, run it,
			// and hand the result back to the same agent on the next step.
			case "tool": {
				if (!ROLE_TOOLS[role].includes(action.tool)) {
					traceLine(
						session,
						`${name(role)} tried to call ${action.tool}: blocked, role may not use this tool`,
					);
					endSession(session, t(session).blocked(), "blocked tool call");

					return session;
				}

				traceLine(
					session,
					`${name(role)} calls ${action.tool}(${JSON.stringify(action.args)})`,
				);
				const result = TOOLS[action.tool](session, action.args);

				traceLine(
					session,
					`${action.tool} result: ${result.ok ? "success" : "failure"} ${JSON.stringify(result)}`,
				);
				event = { type: "tool_result", tool: action.tool, result };
				break;
			}

			// The agent passes control on. Check the handoff is allowed,
			// switch roles, and tell the new agent it just took over.
			case "handoff": {
				if (!HANDOFFS[role].includes(action.to)) {
					traceLine(
						session,
						`${name(role)} -> ${name(action.to)}: blocked, handoff not allowed`,
					);
					endSession(session, t(session).blocked(), "blocked handoff");

					return session;
				}

				traceLine(session, `${name(role)} -> ${name(action.to)} (${action.note})`);
				session.currentRole = action.to;
				event = { type: "handoff", from: role };
				break;
			}

			// The agent needs the customer. Reply and pause the loop.
			case "ask": {
				reply(session, action.text);
				session.status = "waiting";
				traceLine(session, `${name(role)} asks: ${JSON.stringify(action.text)}`);
				traceLine(session, "waiting for customer");

				return session;
			}

			// The agent is done. Reply and close the session.
			case "end": {
				endSession(session, action.text, "final response");

				return session;
			}

			// Anything else is a bug in an agent. Fail closed.
			default: {
				endSession(session, t(session).blocked(), `unknown action ${action.type}`);

				return session;
			}
		}
	}

	// The agents kept going for MAX_STEPS_PER_TURN steps without
	// asking or ending. Stop instead of looping forever.
	endSession(session, t(session).stuck(), "turn step limit reached");

	return session;
}
