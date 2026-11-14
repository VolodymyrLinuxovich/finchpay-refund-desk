import { verificationReceipt, hasValidReceipt } from "./signing.js";

// Mock FinchPay backend. Everything lives in memory and resets when the server restarts.

const CHARGES = {
	"CH-101": {
		id: "CH-101",
		amountCents: 2500,
		currency: "USD",
		description: "FinchPay card charge",
	},
};

const VALID_CODE = "2468";

// Wrong codes allowed per charge before verification is locked for that charge.
export const MAX_VERIFY_ATTEMPTS = 3;
export const LOCK_MINUTES = 15;

// The tool's own proof of a correct code is a signed receipt it writes into the
// session (see src/signing.js). issue_refund checks it as well as session.verified,
// so flipping the flag (by a bug in an agent, or an LLM agent) is not enough.
// A receipt, not an in-memory list, so the proof survives a new server instance.

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
// from a successful result, and the receipt is the tool's own proof of it.
export function verifyIdentity(session, { code, chargeId }, now = Date.now()) {
	const entry = failedAttempts.get(chargeId) ?? { count: 0, lockedUntil: 0 };

	// Locked charges refuse every code, even the right one, until the lock runs out.
	if (entry.lockedUntil > now) {
		return {
			ok: false,
			error: "locked",
			retryAfterMinutes: Math.ceil((entry.lockedUntil - now) / 60000),
		};
	}

	// The lock has expired. Start counting wrong codes from zero again.
	if (entry.lockedUntil && entry.lockedUntil <= now) {
		entry.count = 0;
		entry.lockedUntil = 0;
	}

	// Right code: clear the wrong code count and write the receipt issue_refund checks.
	if (typeof code === "string" && code === VALID_CODE) {
		failedAttempts.delete(chargeId);
		session.verificationReceipt = verificationReceipt(session.id);

		return { ok: true };
	}

	// Wrong code: count it, and lock the charge once the attempts run out.
	entry.count += 1;
	const attemptsLeft = Math.max(0, MAX_VERIFY_ATTEMPTS - entry.count);

	if (attemptsLeft === 0) {
		entry.lockedUntil = now + LOCK_MINUTES * 60000;
	}

	failedAttempts.set(chargeId, entry);

	return { ok: false, error: "invalid_code", attemptsLeft };
}

// issue_refund: the refund rule is enforced here, before anything is recorded.
export function issueRefund(session, { chargeId }) {
	// The rule. Both must hold: the session says it is verified, and it carries a
	// receipt that verify_identity signed for this exact session id.
	if (session.verified !== true || !hasValidReceipt(session)) {
		return { ok: false, error: "identity_not_verified" };
	}

	const charge = getCharge(chargeId);

	if (!charge) {
		return { ok: false, error: "unknown_charge" };
	}

	// One refund per charge, across all sessions.
	if (refunds.some((r) => r.chargeId === chargeId)) {
		return { ok: false, error: "already_refunded" };
	}

	// All checks passed. Record the refund and hand back its reference.
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

// The tools the loop can run, by the names agents use.
export const TOOLS = {
	verify_identity: verifyIdentity,
	issue_refund: issueRefund,
};

// A copy of every refund issued, for the /api/refunds route and tests.
export function listRefunds() {
	return refunds.map((r) => ({ ...r }));
}

// Clears refunds and lockouts. Used by tests and the Reset demo data button.
export function resetStore() {
	refunds.length = 0;
	failedAttempts.clear();
}
