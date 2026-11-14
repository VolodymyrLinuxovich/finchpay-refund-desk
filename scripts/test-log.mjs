// Runs every test suite and keeps a record of each run.
//   TEST_LOG.md                  one row per suite per run, newest at the bottom
//   test-results/history.jsonl   the same rows as JSON lines
//   test-results/<run id>/       full output of each suite in that run
//
// Usage:
//   npm run test:log                 unit + HTTP + randomized, then browser tests
//   ANTHROPIC_API_KEY=... npm run test:log   also runs the live Claude eval
//   npm run test:log -- --note "why this run"   adds a note to every row
import { spawn, execSync } from "node:child_process";
import { mkdir, writeFile, appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const noteIndex = process.argv.indexOf("--note");
const NOTE = noteIndex > -1 ? (process.argv[noteIndex + 1] ?? "") : "";

const SUITES = [
	{
		name: "unit + http + random",
		cmd: [process.execPath, ["--test", "--test-concurrency=1", "test/"]],
		env: { TRACE_CONSOLE: "0" },
		parse: parseNodeTest,
	},
	{
		name: "browser e2e",
		cmd: [process.execPath, ["--test", "--test-concurrency=1", "test-e2e/"]],
		env: { TRACE_CONSOLE: "0", TRIAGE_MODE: "rules" },
		parse: parseNodeTest,
	},
	{
		name: "live Claude eval",
		cmd: [process.execPath, ["scripts/eval-triage.mjs"]],
		env: {},
		parse: parseEval,
		skip: () => (process.env.ANTHROPIC_API_KEY ? null : "no ANTHROPIC_API_KEY"),
	},
];

function parseNodeTest(out) {
	const num = (k) => Number(out.match(new RegExp(`^# ${k} (\\d+)`, "m"))?.[1] ?? 0);
	const failedNames = [...out.matchAll(/^\s*not ok \d+ - (.+)$/gm)]
		.map((m) => m[1])
		.filter((n) => !/^test\//.test(n));

	return {
		passed: num("pass"),
		failed: num("fail"),
		details: failedNames.slice(0, 3).join("; "),
	};
}

function parseEval(out) {
	if (out.includes("API unavailable")) {
		return {
			passed: 0,
			failed: 0,
			details: "API unavailable, Claude never answered",
			error: true,
		};
	}

	const m = out.match(/(\d+)\/(\d+) passed\. Rule held in (\d+)\/(\d+)/);

	if (!m) {
		return { passed: 0, failed: 1, details: "eval did not finish" };
	}

	const failedCases = [...out.matchAll(/^FAIL\s+\d+ms\s+(.+)$/gm)].map((x) => x[1].trim());

	return {
		passed: Number(m[1]),
		failed: Number(m[2]) - Number(m[1]),
		details:
			`rule held ${m[3]}/${m[4]}` +
			(failedCases.length ? `; failed: ${failedCases.join(", ")}` : ""),
	};
}

function run([bin, args], extraEnv) {
	return new Promise((resolve) => {
		const started = Date.now();
		const child = spawn(bin, args, { env: { ...process.env, ...extraEnv } });
		let out = "";

		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (out += d));
		child.on("close", (code) => resolve({ code, out, seconds: (Date.now() - started) / 1000 }));
	});
}

function commit() {
	try {
		const sha = execSync("git rev-parse --short HEAD").toString().trim();
		const dirty = execSync("git status --porcelain -- src public test test-e2e scripts")
			.toString()
			.trim();

		return dirty ? `${sha}+changes` : sha;
	} catch {
		return "no git";
	}
}

const now = new Date();
const runId = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
const when =
	now.toLocaleString("en-US", {
		timeZone: "America/Los_Angeles",
		dateStyle: "short",
		timeStyle: "short",
	}) + " PT";
const sha = commit();

await mkdir(`test-results/${runId}`, { recursive: true });

if (!existsSync("TEST_LOG.md")) {
	await writeFile(
		"TEST_LOG.md",
		[
			"# Test log",
			"",
			"Every run of `npm run test:log` adds one row per suite. Full output of each run is in `test-results/<run>/`.",
			"`+changes` after a commit means the run had uncommitted code changes.",
			"",
			"| When | Commit | Suite | Result | Passed | Failed | Time | Details | Note | Output |",
			"|------|--------|-------|--------|--------|--------|------|---------|------|--------|",
			"",
		].join("\n"),
	);
}

let anyFailed = false;

for (const suite of SUITES) {
	const skipReason = suite.skip?.();
	let row;

	if (skipReason) {
		row = {
			when,
			commit: sha,
			suite: suite.name,
			result: "skipped",
			passed: 0,
			failed: 0,
			seconds: 0,
			details: skipReason,
		};
	} else {
		process.stdout.write(`running ${suite.name}... `);
		const { code, out, seconds } = await run(suite.cmd, suite.env);
		const file = `test-results/${runId}/${suite.name.replace(/[^a-z0-9]+/gi, "-")}.txt`;

		await writeFile(file, out);
		const parsed = suite.parse(out);
		const ok = code === 0 && parsed.failed === 0;
		const result = parsed.error ? "error" : ok ? "pass" : "FAIL";

		anyFailed ||= result !== "pass";
		row = {
			when,
			commit: sha,
			suite: suite.name,
			result,
			...parsed,
			seconds,
			output: file,
		};
		console.log(
			`${row.result} (${parsed.passed} passed, ${parsed.failed} failed, ${seconds.toFixed(1)}s)`,
		);
	}

	row.note = NOTE;
	await appendFile("test-results/history.jsonl", JSON.stringify({ runId, ...row }) + "\n");
	const cell = (s) =>
		String(s ?? "")
			.replace(/\|/g, "\\|")
			.replace(/\n/g, " ");

	await appendFile(
		"TEST_LOG.md",
		`| ${cell(row.when)} | ${cell(row.commit)} | ${cell(row.suite)} | ${row.result === "FAIL" ? "**FAIL**" : row.result} | ${row.passed} | ${row.failed} | ${row.seconds ? row.seconds.toFixed(1) + "s" : ""} | ${cell(row.details)} | ${cell(row.note)} | ${row.output ? `[output](${row.output})` : ""} |\n`,
	);
}

console.log(`\nlogged to TEST_LOG.md (run ${runId})`);
process.exit(anyFailed ? 1 : 0);
