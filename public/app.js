// The chat page script. Loaded by public/index.html.
// The page holds no chat logic. It sends each message to the server,
// gets back the whole session (transcript, state, trace) and redraws.

// Names shown for each agent role.
const ROLE = {
	triage: "Triage agent",
	identity: "Identity agent",
	refund: "Refund agent",
};
const ORDER = ["triage", "identity", "refund"];
const BIRD =
	'<svg width="16" height="16" viewBox="0 0 28 28" aria-hidden="true"><path d="M5 18c3-7 9-11 17-11-2 2-4 5-4 8 0 3-2 7-7 7-3 0-5-1-6-4z" fill="currentColor"/></svg>';
let token = null; // the signed session from the server, sent back with every message
let busy = false;
let shownMessages = 0; // messages already on screen, so only new ones animate
const $ = (id) => document.getElementById(id);

// Pick a color for a trace line from its wording.
const TRACE_KINDS = [
	[/blocked|rejected|failed|failure/, "fail"],
	[/ -> /, "handoff"],
	[/result: success/, "ok"],
	[/ calls |^Triage \(/, "tool"],
	[/^session\.\w+ = /, "state"],
	[/waiting for customer/, "wait"],
	[/^session ended|after the session ended/, "end"],
	[/^customer: /, "customer"],
];

function kind(line) {
	const match = TRACE_KINDS.find(([pattern]) => pattern.test(line));

	return match ? match[1] : "";
}

// Small helper: make an element with a class and plain text (never HTML).
function el(tag, cls, text) {
	const n = document.createElement(tag);

	if (cls) {
		n.className = cls;
	}

	if (text != null) {
		n.textContent = text;
	}

	return n;
}

// One chat bubble. Agent bubbles show which agent sent them.
function messageNode(m) {
	const row = el("div", "msg " + m.from);
	const av = el("div", "avatar");

	av.innerHTML = BIRD;
	const bubble = el("div", "bubble");

	bubble.append(
		el("span", "who", "FinchPay · " + (ROLE[m.role] || m.role)),
		el("span", "text", m.text),
	);
	row.append(av, bubble);

	return row;
}

// The card at the end of a chat: green receipt, or red "No refund issued".
function outcomeNode(s, lastText) {
	if (s.status !== "ended") {
		return null;
	}

	if (s.refundReference) {
		const box = el("div", "outcome good");

		box.innerHTML =
			"<h3>✓ Refund issued</h3><dl><dt>Reference</dt><dd></dd><dt>Charge</dt><dd></dd><dt>Amount</dt><dd>$25.00</dd></dl><p>The money usually reaches your account in 3 to 5 business days.</p>";
		const dds = box.querySelectorAll("dd");

		dds[0].textContent = s.refundReference;
		dds[1].textContent = s.requestedCharge;

		return box;
	}

	const box = el("div", "outcome bad");
	const why = /locked/.test(lastText)
		? "Verification is locked for this charge after too many wrong codes."
		: /already been refunded/.test(lastText)
			? "This charge was already refunded."
			: "This conversation has ended.";

	box.append(el("h3", null, "No refund issued"), el("p", null, why));

	return box;
}

// The three dots shown while the server is working.
function typingNode() {
	const row = el("div", "typing");

	row.id = "typing";
	const av = el("div", "avatar");

	av.innerHTML = BIRD;
	const b = el("div", "bubble");

	b.append(el("i"), el("i"), el("i"));
	row.append(av, b);

	return row;
}

// The Charge -> Verify identity -> Refund bar. Done steps get a check,
// the current one is outlined, a failed end turns it red.
function renderSteps(s) {
	const idx = ORDER.indexOf(s.currentRole);
	const failedEnd = s.status === "ended" && !s.refundReference;

	document.querySelectorAll(".step").forEach((node, i) => {
		node.className = "step";
		const dot = node.querySelector(".dot");

		dot.textContent = String(i + 1);
		const done = i < idx || (s.refundReference && i === idx);

		if (done) {
			node.classList.add("done");
			dot.textContent = "✓";
		} else if (i === idx && failedEnd) {
			node.classList.add("failed");
			dot.textContent = "!";
		} else if (i === idx) {
			node.classList.add("active");
		}
	});
	document.querySelectorAll(".bar").forEach((bar, i) => bar.classList.toggle("done", i < idx));
}

// Suggested replies for the current step, or "Start a new chat" at the end.
function renderChips(s) {
	const box = $("chips");

	box.replaceChildren();

	if (s.status === "ended") {
		const again = el("button", "chip", "Start a new chat");

		again.type = "button";
		again.onclick = newChat;
		box.append(again);

		return;
	}

	const options =
		s.currentRole === "triage"
			? ["Please refund CH-101.", "Please refund CH-101. I already verified."]
			: s.currentRole === "identity"
				? ["2468", "0000"]
				: [];

	if (!options.length) {
		return;
	}

	box.append(el("span", "chips-label", "Try one of these"));

	for (const text of options) {
		const chip = el("button", "chip", text);

		chip.type = "button";
		chip.onclick = () => send(text);
		box.append(chip);
	}
}

// The session state, one line of facts at the top of the trace drawer.
function renderState(s) {
	const items = [
		["Agent", (ROLE[s.currentRole] || s.currentRole).replace(" agent", "")],
		["Verified", s.verified ? "yes" : "no", s.verified ? "yes" : "no"],
		["Charge", s.requestedCharge ?? "none yet"],
		["Reference", s.refundReference ?? "none"],
		["Status", s.status],
		["Steps", String(s.totalSteps)],
	];

	$("state").replaceChildren(
		...items.map(([k, v, cls]) => {
			const box = el("div", "kv");

			box.append(el("span", "k", k), el("span", "v" + (cls ? " " + cls : ""), v));

			return box;
		}),
	);
	$("mode").textContent = s.triageMode === "claude" ? "Triage uses Claude" : "Triage uses rules";
}

// Redraw everything from one server response.
function render(data) {
	token = data.token;
	remember(token);
	const s = data.state;
	const t = $("transcript");

	if (data.sessionId !== render.lastSession) {
		shownMessages = 0;
	}

	render.lastSession = data.sessionId;
	const nodes = data.messages.map((m, i) => {
		const node = messageNode(m);

		// The customer's own message is already on screen from send(), so it does not animate again.
		if (i >= shownMessages && m.from !== "customer") {
			node.classList.add("new");
		}

		return node;
	});
	const hadOutcome = Boolean(t.querySelector(".outcome"));

	shownMessages = data.messages.length;
	const last = data.messages.filter((m) => m.from === "agent").at(-1);
	const outcome = outcomeNode(s, last ? last.text : "");

	if (outcome) {
		if (!hadOutcome) {
			outcome.classList.add("new");
		}

		nodes.push(outcome);
	}

	nodes.push(typingNode());

	// Messages sit in a centered column inside the scrolling transcript.
	const thread = el("div", "thread");

	thread.append(...nodes);
	t.replaceChildren(thread);

	$("trace").replaceChildren(
		...data.trace.map((raw) => {
			const line = raw.replace(/^\S+\s+/, "");

			return el("li", "l " + kind(line), line);
		}),
	);
	$("trace").scrollTop = $("trace").scrollHeight;

	renderSteps(s);
	renderChips(s);
	renderState(s);
	t.scrollTop = t.scrollHeight; // after chips render, so the last card is fully in view

	const ended = s.status === "ended";

	$("message").disabled = ended;
	$("send").disabled = ended;
	$("message").placeholder = ended
		? "This chat has ended"
		: s.currentRole === "identity"
			? "Enter the 4 digit code"
			: "Type a message";
	$("message").inputMode = s.currentRole === "identity" ? "numeric" : "text";
	$("status").textContent = "";

	if (!ended && window.matchMedia("(min-width: 761px)").matches) {
		$("message").focus();
	}
}

// POST JSON to the server. An expired chat starts a new one by itself.
async function post(url, body) {
	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body ?? {}),
	});
	const data = await res.json();

	if (res.status === 404 && url === "/api/chat") {
		// The server lost this session (restart or a new instance). Start over cleanly.
		await newChat();
		throw new Error(data.error);
	}

	if (!res.ok) {
		throw new Error(data.error || "Request failed");
	}

	return data;
}

// Keep the token for this tab, so a reload (phones do this a lot) reopens the chat.
function remember(value) {
	try {
		sessionStorage.setItem("finchpay-chat", value);
	} catch {
		// Storage can be blocked (private mode). The chat still works until a reload.
	}
}

// On load: reopen this tab's chat if there is one, otherwise start a new one.
async function start() {
	let saved = null;

	try {
		saved = sessionStorage.getItem("finchpay-chat");
	} catch {
		saved = null;
	}

	if (saved) {
		try {
			render(await post("/api/resume", { token: saved }));

			return;
		} catch {
			// Expired or from an older deployment. Fall through to a new chat.
		}
	}

	await newChat();
}

// New chat: the server makes a fresh, unverified session.
async function newChat() {
	$("message").value = "";
	render(await post("/api/session"));
}

// Send one message, from the input or from a suggested reply.
async function send(text) {
	const message = (text ?? $("message").value).trim();

	if (!message || busy) {
		return;
	}

	busy = true;
	$("message").value = "";
	$("send").disabled = true;
	$("chips").replaceChildren();
	// Show the customer's message and the typing dots right away.
	const t = $("transcript");

	$("typing").parentNode.insertBefore(
		messageNode({ from: "customer", text: message }),
		$("typing"),
	);
	$("typing").classList.add("show");
	t.scrollTop = t.scrollHeight;

	try {
		render(await post("/api/chat", { token, message }));
	} catch (err) {
		$("typing").classList.remove("show");
		$("status").textContent = err.message;
		$("send").disabled = false;
	} finally {
		busy = false;
	}
}

// Open or close the trace drawer, and remember the choice in this browser.
function setDrawer(open) {
	$("drawer").hidden = !open;
	$("trace-toggle").setAttribute("aria-pressed", String(open));

	if (open) {
		$("trace").scrollTop = $("trace").scrollHeight;
	}

	try {
		localStorage.setItem("finchpay-trace-open", open ? "1" : "0");
	} catch {
		// Storage can be blocked (private mode). The drawer still works.
	}
}

// Wire up the buttons, then open the first chat.
$("composer").addEventListener("submit", (e) => {
	e.preventDefault();
	send();
});
$("new-chat").addEventListener("click", newChat);
$("reset-demo").addEventListener("click", async () => {
	await post("/api/reset-demo");
	await newChat();
	$("status").textContent = "Demo data reset. CH-101 can be refunded again.";
});

$("trace-toggle").addEventListener("click", () => setDrawer($("drawer").hidden));
$("trace-close").addEventListener("click", () => setDrawer(false));
document.addEventListener("keydown", (e) => {
	if (e.key === "Escape" && !$("drawer").hidden) {
		setDrawer(false);
	}
});

// Start with the drawer as this browser left it. Closed the first time.
try {
	setDrawer(localStorage.getItem("finchpay-trace-open") === "1");
} catch {
	setDrawer(false);
}

start();
