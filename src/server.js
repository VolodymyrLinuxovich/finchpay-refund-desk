import http from "node:http";
import { handler } from "./http-handler.js";
import { llmTriageEnabled } from "./llm-triage.js";

// On Vercel this file is the function entry point and Vercel calls the exported handler.
// Locally (npm start) it starts a plain Node HTTP server.
export default handler;

if (!process.env.VERCEL) {
	const PORT = Number(process.env.PORT ?? 3000);

	http.createServer(handler).listen(PORT, () => {
		console.log(`FinchPay refund desk running at http://localhost:${PORT}`);
		console.log(
			`Triage mode: ${llmTriageEnabled() ? "Claude (ANTHROPIC_API_KEY set)" : "rules"}`,
		);
	});
}
