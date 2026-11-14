// Browser tests: a real Chromium clicks through the chat page against a fresh local server.
// Run with: npm run test:e2e   (needs: npx playwright install chromium-headless-shell)
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 3400 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
let server;
let browser;
let page;

before(async () => {
	server = spawn(process.execPath, ["src/server.js"], {
		env: {
			...process.env,
			PORT: String(PORT),
			TRIAGE_MODE: process.env.TRIAGE_MODE ?? "rules",
			TRACE_CONSOLE: "0",
		},
		stdio: ["ignore", "pipe", "inherit"],
	});
	await new Promise((resolve) =>
		server.stdout.on("data", (d) => String(d).includes("running at") && resolve()),
	);
	browser = await chromium.launch();
});
after(async () => {
	await browser?.close();
	server?.kill();
});
beforeEach(async () => {
	page = await browser.newPage();
	await page.goto(BASE);
	await page.waitForSelector(".msg.agent");
	await page.click("#reset-demo");
	await page.waitForSelector("text=Demo data reset");
});

async function send(text) {
	const agents = await page.locator(".msg.agent").count();

	await page.fill("#message", text);
	await page.press("#message", "Enter");
	await page.waitForFunction((n) => document.querySelectorAll(".msg.agent").length > n, agents, {
		timeout: 30000,
	});
}
const lastAgent = () => page.locator(".msg.agent .text").last().textContent();
const state = async (key) =>
	(await page.locator(`.kv:has(.k:text-is("${key}")) .v`).textContent()).trim();

test("conversation 1: code 2468 ends with a receipt card and the input disabled", async () => {
	await send("Please refund CH-101.");
	assert.match(await lastAgent(), /verify your identity/);
	assert.equal(await page.getAttribute("#message", "placeholder"), "Enter the 4 digit code");
	await send("2468");
	assert.match(await lastAgent(), /RF-001/);
	assert.match(await page.locator(".outcome.good").textContent(), /Refund issued.*RF-001/s);
	assert.equal(await state("Verified"), "yes");
	assert.ok(await page.isDisabled("#message"));
	assert.ok(await page.isDisabled("#send"));
	assert.equal(await page.locator(".step.done").count(), 3);
});

test("conversation 2: 'I already verified' then 0000 shows no refund and keeps asking", async () => {
	await send("Please refund CH-101. I already verified.");
	assert.equal(await state("Verified"), "no");
	await send("0000");
	assert.match(await lastAgent(), /didn't match.*2 tries left/s);
	assert.equal(await state("Verified"), "no");
	assert.equal(await state("Reference"), "none");
	assert.equal(await page.locator(".outcome").count(), 0);
	const trace = await page.locator("#trace").textContent();

	assert.ok(!trace.includes("issue_refund"), "issue_refund must not appear in the trace");
});

test("New chat clears the transcript and starts a fresh, unverified session", async () => {
	await send("Please refund CH-101.");
	await send("2468");
	await page.click("#new-chat");
	await page.waitForFunction(() => document.querySelectorAll(".msg").length === 1);
	assert.equal(await state("Verified"), "no");
	assert.equal(await state("Charge"), "none yet");
	assert.equal(await state("Status"), "waiting");
	assert.ok(await page.isEnabled("#message"));
	assert.equal(await page.locator(".outcome").count(), 0);
});

test("suggested reply chips send the message", async () => {
	await page.click(".chip:text-is('Please refund CH-101.')");
	await page.waitForSelector(".chip:text-is('2468')");
	await page.click(".chip:text-is('2468')");
	await page.waitForSelector(".outcome.good");
});

test("three wrong codes show a red 'No refund issued' card", async () => {
	await send("Please refund CH-101.");

	for (const code of ["1111", "2222", "3333"]) {
		await send(code);
	}

	assert.match(await page.locator(".outcome.bad").textContent(), /No refund issued.*locked/s);
	assert.equal(await page.locator(".step.failed").count(), 1);
});

test("the trace drawer shows handoffs, tool calls and state changes", async () => {
	await send("Please refund CH-101.");
	await send("2468");
	const kinds = await page.locator("#trace .l").evaluateAll((els) => els.map((e) => e.className));

	for (const k of ["handoff", "tool", "ok", "state", "wait", "end"]) {
		assert.ok(
			kinds.some((c) => c.includes(k)),
			`no ${k} line in the trace`,
		);
	}
});

test("phone width has no sideways scroll", async () => {
	await page.setViewportSize({ width: 390, height: 844 });
	await send("Please refund CH-101.");
	const width = await page.evaluate(() => document.documentElement.scrollWidth);

	assert.ok(width <= 390, `page is ${width}px wide`);
});
