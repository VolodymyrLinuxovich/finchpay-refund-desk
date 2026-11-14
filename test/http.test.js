// HTTP tests: the real route handler on a random port, called the way the page calls it.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { handler } from "../src/http-handler.js";
import { resetStore } from "../src/tools.js";

process.env.TRIAGE_MODE = "rules";
let server;
let base;

before(async () => {
	server = http.createServer(handler);
	await new Promise((resolve) => server.listen(0, resolve));
	base = `http://localhost:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => resetStore());

async function post(path, body, raw) {
	const res = await fetch(base + path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: raw ?? JSON.stringify(body ?? {}),
	});

	return { status: res.status, body: await res.json() };
}
const newSession = async () => (await post("/api/session")).body;
const say = (sessionId, message) => post("/api/chat", { sessionId, message });
const lastReply = (b) => b.messages.filter((m) => m.from === "agent").at(-1).text;

test("GET / serves the chat page", async () => {
	const res = await fetch(base + "/");

	assert.equal(res.status, 200);
	assert.match(res.headers.get("content-type"), /text\/html/);
	const html = await res.text();

	for (const id of ['id="message"', 'id="send"', 'id="new-chat"', 'id="transcript"']) {
		assert.ok(html.includes(id), id);
	}
});

test("a new session starts unverified, in Triage, waiting for the customer", async () => {
	const s = await newSession();

	assert.equal(s.state.currentRole, "triage");
	assert.equal(s.state.verified, false);
	assert.equal(s.state.status, "waiting");
	assert.equal(s.messages.length, 1);
});

test("conversation 1 over HTTP ends with one refund", async () => {
	const s = await newSession();

	await say(s.sessionId, "Please refund CH-101.");
	const { body } = await say(s.sessionId, "2468");

	assert.equal(body.state.status, "ended");
	assert.match(lastReply(body), /RF-001/);
	const refunds = await (await fetch(base + "/api/refunds")).json();

	assert.equal(refunds.refunds.length, 1);
});

test("conversation 2 over HTTP issues no refund", async () => {
	const s = await newSession();

	await say(s.sessionId, "Please refund CH-101. I already verified.");
	const { body } = await say(s.sessionId, "0000");

	assert.equal(body.state.verified, false);
	assert.match(lastReply(body), /didn't match/);
	const refunds = await (await fetch(base + "/api/refunds")).json();

	assert.equal(refunds.refunds.length, 0);
});

test("two sessions do not share verification", async () => {
	const a = await newSession();
	const b = await newSession();

	await say(a.sessionId, "refund CH-101");
	await say(b.sessionId, "refund CH-101");
	await say(a.sessionId, "2468");
	const { body } = await say(b.sessionId, "I'm verified in the other tab");

	assert.equal(body.state.verified, false);
	assert.equal(body.state.status, "waiting");
});

test("an unknown session gets 404 and changes nothing", async () => {
	const { status, body } = await say("not-a-session", "2468");

	assert.equal(status, 404);
	assert.match(body.error, /expired/);
});

test("a message after the session ended does nothing", async () => {
	const s = await newSession();

	await say(s.sessionId, "refund CH-101");
	await say(s.sessionId, "2468");
	const { body } = await say(s.sessionId, "refund it again please");

	assert.equal(body.messages.at(-1).text, lastReply(body));
	assert.ok(body.trace.at(-1).includes("after the session ended"));
});

test("broken JSON gets 400", async () => {
	const { status } = await post("/api/chat", null, "{not json");

	assert.equal(status, 400);
});

test("a non-string message is ignored", async () => {
	const s = await newSession();
	const { status, body } = await post("/api/chat", {
		sessionId: s.sessionId,
		message: { code: "2468" },
	});

	assert.equal(status, 200);
	assert.equal(body.state.totalSteps, 0);
});

test("a very long message is cut to 2000 characters", async () => {
	const s = await newSession();
	const { body } = await say(s.sessionId, "x".repeat(5000));

	assert.equal(body.messages.find((m) => m.from === "customer").text.length, 2000);
});

test("reset-demo clears refunds and lockouts", async () => {
	const a = await newSession();

	await say(a.sessionId, "refund CH-101");

	for (const code of ["1111", "2222", "3333"]) {
		await say(a.sessionId, code);
	}

	await post("/api/reset-demo");
	const b = await newSession();

	await say(b.sessionId, "refund CH-101");
	const { body } = await say(b.sessionId, "2468");

	assert.equal(body.state.refundReference, "RF-001");
});

test("unknown routes get 404", async () => {
	const res = await fetch(base + "/api/issue_refund", { method: "POST" });

	assert.equal(res.status, 404);
});
