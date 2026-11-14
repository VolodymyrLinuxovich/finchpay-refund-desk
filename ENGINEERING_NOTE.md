# Engineering note

## What runs when the customer sends 2468

The page posts `{ sessionId, message: "2468" }` to `/api/chat`. `src/server.js` finds the session in memory and calls `runTurn` in `src/loop.js`.

At this point the session has `currentRole: "identity"`, `status: "waiting"` and `requestedCharge: "CH-101"`. Triage set the charge on the first turn.

1. `runTurn` records the message and sends a `customer` event to `identity` in `src/agents.js`. Identity finds a 4 digit code, bumps `verifyAttempts` to 1 and returns a `verify_identity` tool action.
2. The loop checks that Identity may call that tool (`ROLE_TOOLS`). It calls `verifyIdentity` in `src/tools.js`. The code matches, so the tool adds the session id to its own `verifiedSessions` set and returns `{ ok: true }`.
3. The loop sends the result back to Identity. Identity sets `session.verified = true` and returns a handoff to Refund. The loop checks the handoff is allowed (`HANDOFFS`) and sets `currentRole = "refund"`.
4. Refund gets a `handoff` event and returns an `issue_refund` action for `session.requestedCharge`.
5. `issueRefund` in `src/tools.js` enforces the rule. Its first check refuses unless `session.verified` is true and the session id is in `verifiedSessions`. Only then does it look up the charge, refuse a repeat refund, and record `RF-001`.
6. Refund sets `refundReference` and returns an `end` action. The loop posts the reply, sets `status = "ended"` and returns.

Execution stops because an agent returned `end`. It would also stop if an agent returned `ask` (pause, status `waiting`), after 8 steps in one turn, or after 40 steps in one session. After `ended`, `runTurn` ignores new messages.

## Design choice

I enforce verification twice inside `issueRefund`. It checks `session.verified` and also a set that only `verifyIdentity` writes to.

The alternative was to trust `session.verified` alone. That is simpler and matches the brief. But the flag sits on an object every agent can write to. If an agent had a bug, or if Identity were later an LLM that could be talked into setting the flag, the refund would go through. With the tool's own record, the only way to pass the check is a successful `verify_identity` call for this exact session id. One test sets the flag by hand and the refund is still refused.

For the same reason the agents are plain functions, not LLM prompts. The task is narrow and the rule matters more than flexible language. Deterministic agents make both traces repeatable and the tests exact. The loop does not care how an agent picks its action, so an LLM could replace any one agent later. The checks in the loop and in the tools would still apply.

On a wrong code I allow another try, up to 3 attempts, then end the conversation. One typo should not end a refund request. A hard cap stops endless guessing in one chat.

## Something it mishandles

Identity takes the first 4 digit number in the message. If the customer writes "I was charged in 2026, my code is 2468", it sends 2026 to `verify_identity`. The customer sees "That code didn't match" and loses an attempt even though they gave the right code. Triage has the same issue with charge IDs. "Not CH-102, I mean CH-101" picks CH-102 and replies that it can't find that charge. I would first change Identity to ask again when a message holds more than one 4 digit number.

A bigger weak spot is that the attempt limit is per session. New chat gives 3 fresh tries, so someone can keep guessing across chats. A real system would limit attempts per customer or per charge, and the code would be per customer and expire.

Other limits. Sessions and refunds live in server memory, so a restart loses them and the page shows "Unknown session". There is no real customer identity. Anyone who verifies can refund CH-101.

## AI tools

I used Claude Code to write the code, tests and trace script. I checked the output by ...
