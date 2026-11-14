// Mock FinchPay backend. Everything lives in memory and resets when the server restarts.

const CHARGES = {
  "CH-101": { id: "CH-101", amountCents: 2500, currency: "USD", description: "FinchPay card charge" },
};

const VALID_CODE = "2468";

// Tool-owned record of which sessions passed verify_identity.
// issue_refund checks this as well as session.verified, so flipping the flag
// on the session object (by a bug in an agent, or a future LLM agent) is not enough.
const verifiedSessions = new Set();

// Issued refunds, in order. Reference numbers come from this list.
const refunds = [];

export function getCharge(chargeId) {
  return CHARGES[chargeId] ?? null;
}

// verify_identity: checks the code and returns success or failure.
// It never changes the session itself. The Identity agent sets session.verified
// from a successful result, and this ledger is the tool's own proof of it.
export function verifyIdentity(session, { code }) {
  const ok = typeof code === "string" && code === VALID_CODE;
  if (ok) verifiedSessions.add(session.id);
  return ok ? { ok: true } : { ok: false, error: "invalid_code" };
}

// issue_refund: the refund rule is enforced here, before anything is recorded.
export function issueRefund(session, { chargeId }) {
  if (session.verified !== true || !verifiedSessions.has(session.id)) {
    return { ok: false, error: "identity_not_verified" };
  }
  const charge = getCharge(chargeId);
  if (!charge) {
    return { ok: false, error: "unknown_charge" };
  }
  if (refunds.some((r) => r.chargeId === chargeId)) {
    return { ok: false, error: "already_refunded" };
  }
  const reference = `RF-${String(refunds.length + 1).padStart(3, "0")}`;
  refunds.push({
    reference,
    chargeId,
    amountCents: charge.amountCents,
    sessionId: session.id,
    createdAt: new Date().toISOString(),
  });
  return { ok: true, reference, amountCents: charge.amountCents, currency: charge.currency };
}

export const TOOLS = {
  verify_identity: verifyIdentity,
  issue_refund: issueRefund,
};

export function listRefunds() {
  return refunds.map((r) => ({ ...r }));
}

// Test helper. Clears refunds and verifications.
export function resetStore() {
  refunds.length = 0;
  verifiedSessions.clear();
}
