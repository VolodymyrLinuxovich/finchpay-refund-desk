import { AGENTS, ROLE_TOOLS, HANDOFFS } from "./agents.js";
import { TOOLS } from "./tools.js";
import { traceLine } from "./session.js";

// Steps allowed while handling one customer message. A normal turn uses at most 3.
export const MAX_STEPS_PER_TURN = 8;
// Steps allowed over the whole conversation, so a customer cannot keep it going forever.
export const MAX_STEPS_PER_SESSION = 40;

const ROLE_NAMES = { triage: "Triage", identity: "Identity", refund: "Refund" };
const name = (role) => ROLE_NAMES[role] ?? role;

function reply(session, text) {
  session.messages.push({ from: "agent", role: session.currentRole, text });
}

function endSession(session, text, why) {
  reply(session, text);
  session.status = "ended";
  traceLine(session, `${name(session.currentRole)} replies: ${JSON.stringify(text)}`);
  traceLine(session, `session ended (${why})`);
}

// Handle one customer message. Runs agent steps until an agent asks the customer
// something (pause), ends the session (stop), or a step limit is hit (stop).
export function runTurn(session, customerText) {
  const text = String(customerText ?? "").trim();
  if (session.status === "ended") {
    traceLine(session, "customer wrote after the session ended, nothing runs");
    return session;
  }
  if (!text) return session;

  session.messages.push({ from: "customer", text });
  session.status = "active";
  traceLine(session, `customer: ${JSON.stringify(text)}`);

  let event = { type: "customer", text };

  for (let step = 0; step < MAX_STEPS_PER_TURN; step++) {
    if (session.totalSteps >= MAX_STEPS_PER_SESSION) {
      endSession(session, "This chat has gone on too long. Please start a new chat.", "session step limit reached");
      return session;
    }
    session.totalSteps++;

    const role = session.currentRole;
    const action = AGENTS[role](session, event);

    switch (action.type) {
      case "tool": {
        if (!ROLE_TOOLS[role].includes(action.tool)) {
          traceLine(session, `${name(role)} tried to call ${action.tool}: blocked, role may not use this tool`);
          endSession(session, "Something went wrong on our side. No changes were made.", "blocked tool call");
          return session;
        }
        traceLine(session, `${name(role)} calls ${action.tool}(${JSON.stringify(action.args)})`);
        const result = TOOLS[action.tool](session, action.args);
        traceLine(
          session,
          `${action.tool} result: ${result.ok ? "success" : "failure"} ${JSON.stringify(result)}`,
        );
        event = { type: "tool_result", tool: action.tool, result };
        break;
      }

      case "handoff": {
        if (!HANDOFFS[role].includes(action.to)) {
          traceLine(session, `${name(role)} -> ${name(action.to)}: blocked, handoff not allowed`);
          endSession(session, "Something went wrong on our side. No changes were made.", "blocked handoff");
          return session;
        }
        traceLine(session, `${name(role)} -> ${name(action.to)} (${action.note})`);
        session.currentRole = action.to;
        event = { type: "handoff", from: role };
        break;
      }

      case "ask": {
        reply(session, action.text);
        session.status = "waiting";
        traceLine(session, `${name(role)} asks: ${JSON.stringify(action.text)}`);
        traceLine(session, "waiting for customer");
        return session;
      }

      case "end": {
        endSession(session, action.text, "final response");
        return session;
      }

      default: {
        endSession(session, "Something went wrong on our side. No changes were made.", `unknown action ${action.type}`);
        return session;
      }
    }
  }

  endSession(session, "Sorry, I got stuck handling that. Please start a new chat.", "turn step limit reached");
  return session;
}
