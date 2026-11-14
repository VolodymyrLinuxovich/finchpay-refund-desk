// Mock FinchPay backend. Everything lives in memory and resets when the server restarts.

const CHARGES = {
  "CH-101": { id: "CH-101", amountCents: 2500, currency: "USD", description: "FinchPay card charge" },
};

const VALID_CODE = "2468";

// Wrong codes allowed per charge before verification is locked for that charge.
export const MAX_VERIFY_ATTEMPTS = 3;
export const LOCK_MINUTES = 15;

// Tool-owned record of which sessions passed verify_identity.
// issue_refund checks this as well as session.verified, so flipping the flag
// on the session object (by a bug in an agent, or an LLM agent) is not enough.
const verifiedSessions = new Set();

// Wrong code count per charge. Kept here, not on the session, so New chat
// does not give a caller fresh guesses.
const failedAttempts = new Map(); // chargeId -> { count, lockedUntil }

// Issued refunds, in order. Reference numbers come from this list.
const refunds = [];

export function getCharge(chargeId) {
  return CHARGES[chargeId] ?? null;
}

// verify_identity: checks the code for the requested charge and returns success or failure.
// It never changes the session itself. The Identity agent sets session.verified
// from a successful result, and verifiedSessions is the tool's own proof of it.
export function verifyIdentity(session, { code, chargeId }, now = Date.now()) {
  const entry = failedAttempts.get(chargeId) ?? { count: 0, lockedUntil: 0 };
  if (entry.lockedUntil > now) {
    return { ok: false, error: "locked", retryAfterMinutes: Math.ceil((entry.lockedUntil - now) / 60000) };
  }
  if (entry.lockedUntil && entry.lockedUntil <= now) {
    entry.count = 0;
    entry.lockedUntil = 0;
  }

  if (typeof code === "string" && code === VALID_CODE) {
    failedAttempts.delete(chargeId);
    verifiedSessions.add(session.id);
    return { ok: true };
  }

  entry.count += 1;
  const attemptsLeft = Math.max(0, MAX_VERIFY_ATTEMPTS - entry.count);
  if (attemptsLeft === 0) entry.lockedUntil = now + LOCK_MINUTES * 60000;
  failedAttempts.set(chargeId, entry);
  return { ok: false, error: "invalid_code", attemptsLeft };
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

// Test helper. Clears refunds, verifications and lockouts.
export function resetStore() {
  refunds.length = 0;
  verifiedSessions.clear();
  failedAttempts.clear();
}
