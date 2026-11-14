import { getCharge } from "./tools.js";
import { setState } from "./session.js";

// Each agent is a plain function: (session, event) -> action.
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
// Agents may write their own fields in session state (requestedCharge, verified,
// verifyAttempts). They never change currentRole or status. The loop owns those.

export const MAX_VERIFY_ATTEMPTS = 3;

const CHARGE_PATTERN = /\bCH-?(\d+)\b/i;
const CODE_PATTERN = /\b(\d{4})\b/;

function formatAmount(cents, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function triage(session, event) {
  if (event.type !== "customer") {
    return { type: "ask", text: "Hi, this is the FinchPay refund desk. Which charge would you like refunded?" };
  }
  const match = event.text.match(CHARGE_PATTERN);
  if (!match) {
    return { type: "ask", text: "I can help with a refund. Which charge is it? Charge IDs look like CH-101." };
  }
  const chargeId = `CH-${match[1]}`;
  if (!getCharge(chargeId)) {
    return { type: "ask", text: `I couldn't find a charge called ${chargeId}. Please check the ID and send it again.` };
  }
  // Anything else in the message ("I already verified", a code, etc.) is ignored here.
  // Triage only records which charge the customer wants.
  setState(session, "requestedCharge", chargeId);
  return { type: "handoff", to: "identity", note: `requested charge ${chargeId}` };
}

export function identity(session, event) {
  if (event.type === "handoff") {
    // Always ask for a fresh code, even if the customer says they already verified.
    return {
      type: "ask",
      text: "Before I refund this charge I need to verify your identity. Please enter the 4 digit code we sent to your phone.",
    };
  }

  if (event.type === "customer") {
    const match = event.text.match(CODE_PATTERN);
    if (!match) {
      return { type: "ask", text: "I need the 4 digit verification code to continue. Please type just the code." };
    }
    setState(session, "verifyAttempts", session.verifyAttempts + 1);
    return { type: "tool", tool: "verify_identity", args: { code: match[1] } };
  }

  if (event.type === "tool_result" && event.tool === "verify_identity") {
    if (event.result.ok) {
      setState(session, "verified", true);
      return { type: "handoff", to: "refund", note: "identity verified" };
    }
    const left = MAX_VERIFY_ATTEMPTS - session.verifyAttempts;
    if (left > 0) {
      return {
        type: "ask",
        text: `That code didn't match, so I couldn't verify your identity. You have ${left} ${left === 1 ? "try" : "tries"} left. Please enter the code again.`,
      };
    }
    return {
      type: "end",
      text: "That code didn't match and there are no tries left, so I couldn't verify your identity. No refund was issued. Please start a new chat or contact FinchPay support.",
    };
  }

  return { type: "end", text: "Something went wrong during verification. No refund was issued." };
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
        text: `Done. I refunded ${formatAmount(r.amountCents, r.currency)} for ${session.requestedCharge}. Your refund reference is ${r.reference}.`,
      };
    }
    const reasons = {
      identity_not_verified: "your identity isn't verified in this chat",
      already_refunded: "this charge has already been refunded",
      unknown_charge: "I couldn't find that charge",
    };
    return { type: "end", text: `I couldn't issue the refund because ${reasons[r.error] ?? r.error}. No refund was issued.` };
  }

  // Refund has nothing to ask the customer, so any other event ends the session.
  return { type: "end", text: "Your refund request is closed. Please start a new chat if you need anything else." };
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
