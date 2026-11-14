// Drives the two required conversations through the real chat page in a headless
// browser and saves the trace panel of each to traces/.
// Usage: start the server (npm start), then: npm run traces
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const CONVERSATIONS = [
  { file: "traces/01-refund-succeeds.txt", title: "Refund succeeds", turns: ["Please refund CH-101.", "2468"] },
  {
    file: "traces/02-claims-verified.txt",
    title: "Customer claims to be verified",
    turns: ["Please refund CH-101. I already verified.", "0000"],
  },
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE);

for (const convo of CONVERSATIONS) {
  // Fresh, unverified session for each conversation, through the New chat button.
  await page.click("#new-chat");
  await page.waitForFunction(() => document.querySelectorAll(".msg").length === 1);

  for (const text of convo.turns) {
    const before = await page.locator(".msg").count();
    await page.fill("#message", text);
    await page.click("#send");
    // Wait for the customer message plus at least one agent reply.
    await page.waitForFunction((n) => document.querySelectorAll(".msg").length >= n + 2, before);
  }

  const transcript = await page.locator(".msg").evaluateAll((els) =>
    els.map((el) => `${el.querySelector(".who").textContent}: ${el.lastChild.textContent}`),
  );
  const state = await page.locator("#state").textContent();
  const trace = await page.locator("#trace").textContent();

  const out = [
    `# ${convo.title}`,
    `# Recorded ${new Date().toISOString()} from the chat page at ${BASE}`,
    "",
    "## Transcript",
    ...transcript,
    "",
    "## Final session state",
    state,
    "",
    "## Trace",
    trace,
    "",
  ].join("\n");
  await writeFile(convo.file, out);
  console.log(`saved ${convo.file}`);
}

const refunds = await (await fetch(`${BASE}/api/refunds`)).json();
console.log("refunds in memory after both conversations:", JSON.stringify(refunds.refunds));
await browser.close();
