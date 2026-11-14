# FinchPay refund desk

A chat refund agent for FinchPay, a fictional fintech. Three agents hand off in order. Triage finds the charge. Identity checks a verification code. Refund issues the refund. The rule is that `issue_refund` only runs after `verify_identity` has succeeded in the same session.

The agents are plain functions, not LLM calls. There is no API key and nothing to configure. See [ENGINEERING_NOTE.md](ENGINEERING_NOTE.md) for why.

## Run it

Needs Node 18 or newer. The app has no dependencies.

```bash
npm start
# open http://localhost:3000
```

Use a different port with `PORT=4000 npm start`.

Mock data: one charge, `CH-101` for $25. The valid code is `2468`.

## Tests

```bash
npm test
```

12 tests cover both required conversations, three wrong codes, the refund rule called directly, a forged `session.verified` flag, double refunds, unknown charges, the step limit, and blocked tools and handoffs.

## Traces

The two required conversations were run through the chat page, each after pressing New chat.

| File | Conversation |
| --- | --- |
| [traces/01-refund-succeeds.txt](traces/01-refund-succeeds.txt) | "Please refund CH-101." then "2468" |
| [traces/02-claims-verified.txt](traces/02-claims-verified.txt) | "Please refund CH-101. I already verified." then "0000" |
| [traces/server-console.log](traces/server-console.log) | Server console output from the same run |

Each file has the transcript, the final session state and the trace panel text. The page shows the same trace live in the right panel. The server also prints it to the console and writes it to `traces/live/<session id>.log` (not committed).

To record them again with a headless browser:

```bash
npm install            # installs Playwright, only needed for this script
npx playwright install chromium-headless-shell
npm start              # in one terminal
npm run traces         # in another
```

## Layout

| File | What it does |
| --- | --- |
| `src/loop.js` | `runTurn`, the agent loop. Runs tools, switches roles, pauses, ends, enforces step limits and per role permissions |
| `src/agents.js` | `triage`, `identity`, `refund` agents, plus which tools and handoffs each role may use |
| `src/tools.js` | `verify_identity` and `issue_refund`, mock charge and refund store. The refund rule lives in `issueRefund` |
| `src/session.js` | The shared session object and trace helpers |
| `src/server.js` | HTTP server. Holds sessions in memory, serves the page and `/api/session`, `/api/chat`, `/api/refunds` |
| `public/index.html` | Chat page with transcript, message field, Send, New chat, session state and trace panels |

## Behaviour

* Saying "I already verified" changes nothing. Only a successful `verify_identity` result sets `session.verified`.
* A wrong code allows another try. After 3 wrong codes the conversation ends with no refund (`MAX_VERIFY_ATTEMPTS` in `src/agents.js`).
* Once a session has ended, new messages do nothing. New chat starts a fresh, unverified session.
* A charge can only be refunded once across all sessions.
