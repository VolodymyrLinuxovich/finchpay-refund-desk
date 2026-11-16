# Engineering note

## What runs when the customer sends 2468

The page posts `{ sessionId, message: "2468" }` to `/api/chat`. `src/http-handler.js` finds the session in memory and awaits `runTurn` in `src/loop.js:26`.

At this point the session has `currentRole: "identity"`, `status: "waiting"` and `requestedCharge: "CH-101"`. Triage set the charge on the first turn.

1. `runTurn` records the message and sends a `customer` event to `identity` (`src/agents.js:86`). Identity finds exactly one 4 digit number and returns a `verify_identity` action with the code and the charge.
2. The loop checks that Identity may call that tool (`ROLE_TOOLS`, `src/loop.js:52`). It calls `verifyIdentity` (`src/tools.js:32`). The charge is not locked and the code matches. The tool clears the wrong code count, writes a receipt signed with its own key and bound to this session id, and returns `{ ok: true }`.
3. The loop sends the result back to Identity. Identity sets `session.verified = true` (`src/agents.js:110`) and returns a handoff to Refund. The loop checks the handoff is allowed (`HANDOFFS`, `src/loop.js:68`) and sets `currentRole = "refund"`.
4. Refund gets a `handoff` event and returns an `issue_refund` action for `session.requestedCharge`.
5. `issueRefund` (`src/tools.js:56`) enforces the rule. Its first check refuses unless `session.verified` is true and the session carries a valid receipt from `verify_identity`. Only then does it look up the charge, refuse a repeat refund, and record `RF-001`.
6. Refund sets `refundReference` and returns an `end` action. The loop posts the reply, sets `status = "ended"` and returns.

Execution stops because an agent returned `end`. It also stops when an agent returns `ask` (pause, status `waiting`), after 8 steps in one turn, or after 40 steps in one session. After `ended`, `runTurn` ignores new messages.

## Design choice

`issueRefund` checks verification twice. It checks `session.verified` and also a receipt that only `verifyIdentity` can sign.

The alternative was to trust `session.verified` alone. That is simpler and matches the brief. But the flag sits on an object every agent can write to. Triage now calls Claude. If a later change let a model influence state, or an agent had a bug, the flag could be set without a real check. With the signed receipt, the only way through is a successful `verify_identity` call for this exact session id. One test sets the flag by hand and the refund is still refused.

The same idea shaped where Claude sits. Only Triage uses it, and only to read which charge the customer means. It has no tools. Its answer is checked in code: the charge must exist and the customer must have actually written it. The loop only lets Triage hand off to Identity. So a prompt injection in the first message can at most pick a charge. It cannot skip the code. Trace 03 shows this. Identity and Refund stay plain code because they guard the money and gain nothing from flexible language.

On a wrong code I allow another try. After 3 wrong codes for a charge, that charge locks for 15 minutes. The count lives in the tool, not the session, so New chat does not give fresh guesses. Trace 04 shows this.

## Something it mishandles

The lockout is per charge and nothing ties a chat to a real customer. Anyone who knows a charge ID can send three wrong codes and lock it. The real customer then sees "Verification for this charge is locked... try again in 15 minutes" and cannot get their refund. I chose to block guessing at the cost of this. In a real system the customer would be logged in, so attempts would count per customer and device, and the code would be sent to them and expire. I would add a customer identity first, then key the lockout and the code on it.

Other weak spots. Each chat travels as a signed token, so it survives a new Vercel instance, but refunds and lockouts live in server memory and a new instance starts without them. On the public demo everyone shares one store, which is why the page has a Reset demo data button. The tests cover the Claude path with a fake client, so they do not show how the real model behaves on unusual input. The traces only cover five real calls.

## AI tools

I used Claude Code to write the code, tests and trace script. I checked the output by reading the parts that guard money myself. That means the loop, the two tools and the Identity and Refund agents. The walkthrough of the 2468 turn above comes from that reading, with line numbers I checked.

I did not take a passing test as proof on its own. For the refund rule I asked for tests that try to break it. One sets `session.verified` by hand. Another hands off to Refund without a code. Both must end with no refund.

The Claude part cannot be checked by reading. So there is a live eval that sends 20 messages to the real model, including prompt injections and messages that name two charges. Every run is logged in `TEST_LOG.md` with its full output, failures included. The refund rule held in every run. The failures were Triage picking the wrong charge or answering in a way the eval did not expect. One was "Refund CH101 please", which Triage missed because the ID had no dash. I fixed each one and wrote down why next to the run.

Last, I watched the browser traces and used the live demo myself. That is how I found things the tests missed, like a chat being lost when Vercel started a new instance.
