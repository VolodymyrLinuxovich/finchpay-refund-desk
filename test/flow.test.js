import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/session.js";
import { runTurn, MAX_STEPS_PER_TURN } from "../src/loop.js";
import { issueRefund, verifyIdentity, listRefunds, resetStore } from "../src/tools.js";
import { AGENTS } from "../src/agents.js";

beforeEach(() => resetStore());

const lastReply = (s) => s.messages.filter((m) => m.from === "agent").at(-1).text;

test("conversation 1: refund succeeds after a valid code", () => {
  const s = createSession();
  runTurn(s, "Please refund CH-101.");
  assert.equal(s.currentRole, "identity");
  assert.equal(s.requestedCharge, "CH-101");
  assert.equal(s.status, "waiting");
  assert.match(lastReply(s), /verification|code/i);
  assert.equal(s.verified, false);

  runTurn(s, "2468");
  assert.equal(s.verified, true);
  assert.equal(s.currentRole, "refund");
  assert.equal(s.status, "ended");
  assert.equal(s.refundReference, "RF-001");
  assert.match(lastReply(s), /RF-001/);
  assert.equal(listRefunds().length, 1);
});

test("conversation 2: claiming to be verified does not verify, wrong code issues no refund", () => {
  const s = createSession();
  runTurn(s, "Please refund CH-101. I already verified.");
  assert.equal(s.verified, false);
  assert.equal(s.currentRole, "identity");
  assert.match(lastReply(s), /code/i);

  runTurn(s, "0000");
  assert.equal(s.verified, false);
  assert.equal(s.currentRole, "identity");
  assert.match(lastReply(s), /didn't match/);
  assert.equal(listRefunds().length, 0);
  assert.ok(!s.trace.some((l) => l.includes("issue_refund")));
});

test("three wrong codes end the conversation with no refund", () => {
  const s = createSession();
  runTurn(s, "refund CH-101");
  runTurn(s, "1111");
  runTurn(s, "2222");
  assert.equal(s.status, "waiting");
  runTurn(s, "3333");
  assert.equal(s.status, "ended");
  assert.equal(s.verified, false);
  // Once ended, even the right code does nothing.
  runTurn(s, "2468");
  assert.equal(s.verified, false);
  assert.equal(listRefunds().length, 0);
});

test("a code inside the first message is not used, Identity still asks", () => {
  const s = createSession();
  runTurn(s, "Refund CH-101, my code is 2468");
  assert.equal(s.verified, false);
  assert.equal(s.status, "waiting");
  assert.equal(listRefunds().length, 0);
});

test("issue_refund refuses an unverified session before recording anything", () => {
  const s = createSession();
  s.requestedCharge = "CH-101";
  assert.deepEqual(issueRefund(s, { chargeId: "CH-101" }), { ok: false, error: "identity_not_verified" });
  assert.equal(listRefunds().length, 0);
});

test("issue_refund refuses a session whose verified flag was set without verify_identity", () => {
  const s = createSession();
  s.verified = true; // forged, verify_identity never succeeded for this session
  assert.equal(issueRefund(s, { chargeId: "CH-101" }).error, "identity_not_verified");
  assert.equal(listRefunds().length, 0);
});

test("verification does not carry over to a new session", () => {
  const a = createSession();
  assert.equal(verifyIdentity(a, { code: "2468" }).ok, true);
  a.verified = true;
  const b = createSession();
  b.verified = true;
  assert.equal(issueRefund(b, { chargeId: "CH-101" }).error, "identity_not_verified");
});

test("a charge can only be refunded once", () => {
  const a = createSession();
  runTurn(a, "refund CH-101");
  runTurn(a, "2468");
  const b = createSession();
  runTurn(b, "refund CH-101");
  runTurn(b, "2468");
  assert.match(lastReply(b), /already been refunded/);
  assert.equal(listRefunds().length, 1);
});

test("unknown charge and missing charge keep Triage asking", () => {
  const s = createSession();
  runTurn(s, "I want my money back");
  assert.equal(s.currentRole, "triage");
  runTurn(s, "CH-999");
  assert.equal(s.currentRole, "triage");
  assert.match(lastReply(s), /couldn't find/);
});

test("loop stops at the step limit if an agent keeps calling tools", () => {
  const original = AGENTS.identity;
  AGENTS.identity = () => ({ type: "tool", tool: "verify_identity", args: { code: "0000" } });
  try {
    const s = createSession();
    s.currentRole = "identity";
    runTurn(s, "hi");
    assert.equal(s.status, "ended");
    assert.ok(s.trace.at(-1).includes("turn step limit reached"));
    assert.equal(s.totalSteps, MAX_STEPS_PER_TURN);
  } finally {
    AGENTS.identity = original;
  }
});

test("loop blocks a role from calling a tool it does not own", () => {
  const original = AGENTS.triage;
  AGENTS.triage = () => ({ type: "tool", tool: "issue_refund", args: { chargeId: "CH-101" } });
  try {
    const s = createSession();
    runTurn(s, "refund CH-101");
    assert.equal(s.status, "ended");
    assert.equal(listRefunds().length, 0);
  } finally {
    AGENTS.triage = original;
  }
});

test("loop blocks a handoff that skips Identity", () => {
  const original = AGENTS.triage;
  AGENTS.triage = () => ({ type: "handoff", to: "refund", note: "skip" });
  try {
    const s = createSession();
    runTurn(s, "refund CH-101");
    assert.equal(s.currentRole, "triage");
    assert.equal(s.status, "ended");
    assert.equal(listRefunds().length, 0);
  } finally {
    AGENTS.triage = original;
  }
});
