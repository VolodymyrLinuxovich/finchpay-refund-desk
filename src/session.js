import { randomUUID } from "node:crypto";

// One session object is shared by every role and every turn of a conversation.
// The loop (src/loop.js) is the only code that changes currentRole and status.
export function createSession() {
  return {
    id: randomUUID(),
    currentRole: "triage", // triage | identity | refund
    status: "active", // active | waiting | ended
    requestedCharge: null, // set by Triage, e.g. "CH-101"
    verified: false, // set by Identity, only after verify_identity succeeds
    verifyAttempts: 0,
    refundReference: null,
    totalSteps: 0,
    messages: [], // [{ from: "customer" | "agent", role?, text }]
    trace: [], // human readable lines, see traceLine()
  };
}

// Every trace line also goes to the server console so there is a log outside the page.
export function traceLine(session, text) {
  const line = `${new Date().toISOString()}  ${text}`;
  session.trace.push(line);
  if (process.env.TRACE_CONSOLE !== "0") {
    console.log(`[${session.id.slice(0, 8)}] ${text}`);
  }
}

// Record a state change with the old and new value so the trace shows it.
export function setState(session, key, value) {
  const before = session[key];
  session[key] = value;
  traceLine(session, `session.${key} = ${JSON.stringify(value)} (was ${JSON.stringify(before)})`);
}
