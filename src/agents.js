import { getCharge, LOCK_MINUTES } from "./tools.js";
import { setState, traceLine } from "./session.js";
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

function formatAmount(cents, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

function normalizeChargeId(raw) {
  const m = /^CH-?(\d+)$/i.exec(String(raw).trim());
  return m ? `CH-${m[1]}` : null;
}

// Rule-based reading of the charge. Used when there is no LLM, or the LLM call fails.
function chargeFromRules(text) {
  const ids = [...new Set([...text.matchAll(CHARGE_PATTERN)].map((m) => `CH-${m[1]}`))];
  if (ids.length === 1) return { chargeId: ids[0], reply: "" };
  if (ids.length > 1) {
    return { chargeId: null, reply: `You mentioned ${ids.join(" and ")}. Which one should I refund?` };
  }
  return { chargeId: null, reply: "I can help with a refund. Which charge is it? Charge IDs look like CH-101." };
}

// Triage reads which charge the customer wants and hands off to Identity.
// With an API key, Claude reads the message. Its answer is untrusted: the charge
// must exist and must appear in what the customer actually wrote.
export async function triage(session, event) {
  if (event.type !== "customer") {
    return { type: "ask", text: "Hi, this is the FinchPay refund desk. Which charge would you like refunded?" };
  }
  const customerTexts = session.messages.filter((m) => m.from === "customer").map((m) => m.text);

  let read = null;
  if (llmTriageEnabled()) {
    try {
      read = await askClaudeForCharge(customerTexts);
      traceLine(session, `Triage (Claude) read the request: ${JSON.stringify(read)}`);
      const id = read.chargeId && normalizeChargeId(read.chargeId);
      const written = new Set(customerTexts.flatMap((t) => [...t.matchAll(CHARGE_PATTERN)].map((m) => `CH-${m[1]}`)));
      if (read.chargeId && (!id || !written.has(id))) {
        traceLine(session, `Triage rejected Claude's charge ${JSON.stringify(read.chargeId)}: customer never wrote it`);
        read = chargeFromRules(event.text);
      } else {
        read.chargeId = id;
      }
    } catch (err) {
      traceLine(session, `Triage (Claude) failed: ${String(err.message).slice(0, 140)}. Using rule-based triage`);
      read = null;
    }
  }
  if (!read) {
    read = chargeFromRules(event.text);
    traceLine(session, `Triage (rules) read the request: ${JSON.stringify(read)}`);
  }

  if (!read.chargeId) {
    return { type: "ask", text: read.reply || "Which charge would you like refunded? Charge IDs look like CH-101." };
  }
  if (!getCharge(read.chargeId)) {
    return { type: "ask", text: `I couldn't find a charge called ${read.chargeId}. Please check the ID and send it again.` };
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
      text: "Before I refund this charge I need to verify your identity. Please enter the 4 digit code we sent to your phone.",
    };
  }

  if (event.type === "customer") {
    const codes = [...new Set(event.text.match(CODE_PATTERN) ?? [])];
    if (codes.length === 0) {
      return { type: "ask", text: "I need the 4 digit verification code to continue. Please type just the code." };
    }
    if (codes.length > 1) {
      // Do not guess which number is the code. Guessing wrong would cost an attempt.
      return { type: "ask", text: `I see more than one 4 digit number (${codes.join(", ")}). Please send just the verification code.` };
    }
    return { type: "tool", tool: "verify_identity", args: { code: codes[0], chargeId: session.requestedCharge } };
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
        text: `That code didn't match, so I couldn't verify your identity. You have ${r.attemptsLeft} ${r.attemptsLeft === 1 ? "try" : "tries"} left. Please enter the code again.`,
      };
    }
    if (r.error === "invalid_code") {
      return {
        type: "end",
        text: `That code didn't match and there are no tries left. Verification for this charge is locked for ${LOCK_MINUTES} minutes. No refund was issued.`,
      };
    }
    if (r.error === "locked") {
      return {
        type: "end",
        text: `Verification for this charge is locked after too many wrong codes. Please try again in ${r.retryAfterMinutes} minutes. No refund was issued.`,
      };
    }
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
