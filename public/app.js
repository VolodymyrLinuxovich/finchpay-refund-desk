// The chat page script. Loaded by public/index.html.
// The page holds no chat logic. It sends each message to the server,
// gets back the whole session (transcript, state, trace) and redraws.

// Page text in English, Spanish and French. Agent replies are translated on the
// server (src/i18n.js). The trace drawer stays in English: it is an engineering log.
const UI = {
	en: {
		subtitle: "Refund help",
		stepCharge: "Charge",
		stepVerify: "Verify identity",
		stepRefund: "Refund",
		trace: "Agent trace",
		traceShort: "Trace",
		newChat: "New chat",
		send: "Send",
		demoCharge: "Demo charge",
		demoCode: "code",
		reset: "Reset demo data",
		roles: { triage: "Triage agent", identity: "Identity agent", refund: "Refund agent" },
		chipsCharge: ["Please refund CH-101.", "Please refund CH-101. I already verified."],
		tryThese: "Try one of these",
		startNew: "Start a new chat",
		typeMessage: "Type a message",
		enterCode: "Enter the 4 digit code",
		ended: "This chat has ended",
		issued: "Refund issued",
		reference: "Reference",
		charge: "Charge",
		amount: "Amount",
		arrives: "The money usually reaches your account in 3 to 5 business days.",
		noRefund: "No refund issued",
		whyLocked: "Verification is locked for this charge after too many wrong codes.",
		whyRefunded: "This charge was already refunded.",
		whyEnded: "This conversation has ended.",
		resetDone: "Demo data reset. CH-101 can be refunded again.",
	},
	es: {
		subtitle: "Ayuda con reembolsos",
		stepCharge: "Cargo",
		stepVerify: "Verificar identidad",
		stepRefund: "Reembolso",
		trace: "Traza de agentes",
		traceShort: "Traza",
		newChat: "Chat nuevo",
		send: "Enviar",
		demoCharge: "Cargo de prueba",
		demoCode: "código",
		reset: "Reiniciar datos de prueba",
		roles: {
			triage: "Agente de recepción",
			identity: "Agente de identidad",
			refund: "Agente de reembolsos",
		},
		chipsCharge: [
			"Por favor, reembolsa CH-101.",
			"Por favor, reembolsa CH-101. Ya me verifiqué.",
		],
		tryThese: "Prueba una de estas",
		startNew: "Empezar un chat nuevo",
		typeMessage: "Escribe un mensaje",
		enterCode: "Escribe el código de 4 dígitos",
		ended: "Este chat terminó",
		issued: "Reembolso hecho",
		reference: "Número",
		charge: "Cargo",
		amount: "Importe",
		arrives: "El dinero suele llegar a tu cuenta en 3 a 5 días hábiles.",
		noRefund: "No se hizo ningún reembolso",
		whyLocked:
			"La verificación de este cargo está bloqueada por demasiados códigos incorrectos.",
		whyRefunded: "Este cargo ya fue reembolsado.",
		whyEnded: "Esta conversación terminó.",
		resetDone: "Datos de prueba reiniciados. CH-101 se puede reembolsar otra vez.",
	},
	fr: {
		subtitle: "Aide au remboursement",
		stepCharge: "Prélèvement",
		stepVerify: "Vérifier l'identité",
		stepRefund: "Remboursement",
		trace: "Trace des agents",
		traceShort: "Trace",
		newChat: "Nouveau chat",
		send: "Envoyer",
		demoCharge: "Prélèvement de démo",
		demoCode: "code",
		reset: "Réinitialiser la démo",
		roles: {
			triage: "Agent d'accueil",
			identity: "Agent d'identité",
			refund: "Agent de remboursement",
		},
		chipsCharge: [
			"Merci de rembourser CH-101.",
			"Merci de rembourser CH-101. Je suis déjà vérifié.",
		],
		tryThese: "Essayez l'une de ces réponses",
		startNew: "Ouvrir un nouveau chat",
		typeMessage: "Écrivez un message",
		enterCode: "Saisissez le code à 4 chiffres",
		ended: "Ce chat est terminé",
		issued: "Remboursement effectué",
		reference: "Référence",
		charge: "Prélèvement",
		amount: "Montant",
		arrives: "L'argent arrive en général sur votre compte sous 3 à 5 jours ouvrés.",
		noRefund: "Aucun remboursement effectué",
		whyLocked: "La vérification de ce prélèvement est bloquée après trop de codes erronés.",
		whyRefunded: "Ce prélèvement a déjà été remboursé.",
		whyEnded: "Cette conversation est terminée.",
		resetDone: "Démo réinitialisée. CH-101 peut de nouveau être remboursé.",
	},
};
const LOCALES = { en: "en-US", es: "es-ES", fr: "fr-FR" };

// The chosen language: saved choice, else the browser's language, else English.
let lang = (() => {
	try {
		const saved = localStorage.getItem("finchpay-lang");

		if (UI[saved]) {
			return saved;
		}
	} catch {
		// Storage can be blocked. Fall back to the browser's language.
	}

	const browser = (navigator.language || "en").slice(0, 2);

	return UI[browser] ? browser : "en";
})();
const tr = () => UI[lang];

// Names shown for each agent role. The trace drawer uses the English ones.
const ROLE = UI.en.roles;
const ORDER = ["triage", "identity", "refund"];
const BIRD =
	'<svg width="16" height="16" viewBox="0 0 28 28" aria-hidden="true"><path d="M5 18c3-7 9-11 17-11-2 2-4 5-4 8 0 3-2 7-7 7-3 0-5-1-6-4z" fill="currentColor"/></svg>';
let token = null; // the signed session from the server, sent back with every message
let busy = false;
let shownMessages = 0; // messages already on screen, so only new ones animate
let lastData = null; // the last server response, to redraw when the language changes
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
		el("span", "who", "FinchPay · " + (tr().roles[m.role] || m.role)),
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

		const amount = new Intl.NumberFormat(LOCALES[lang], {
			style: "currency",
			currency: "USD",
		}).format(25);
		const list = el("dl");

		for (const [k, v] of [
			[tr().reference, s.refundReference],
			[tr().charge, s.requestedCharge],
			[tr().amount, amount],
		]) {
			list.append(el("dt", null, k), el("dd", null, v));
		}

		box.append(el("h3", null, "✓ " + tr().issued), list, el("p", null, tr().arrives));

		return box;
	}

	const box = el("div", "outcome bad");
	// The reason comes from the last reply, which may be in any of the three languages.
	const why = /locked|bloquead|bloquée/.test(lastText)
		? tr().whyLocked
		: /already been refunded|ya fue reembolsado|déjà été remboursé/.test(lastText)
			? tr().whyRefunded
			: tr().whyEnded;

	box.append(el("h3", null, tr().noRefund), el("p", null, why));

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
		const again = el("button", "chip", tr().startNew);

		again.type = "button";
		again.onclick = newChat;
		box.append(again);

		return;
	}

	const options =
		s.currentRole === "triage"
			? tr().chipsCharge
			: s.currentRole === "identity"
				? ["2468", "0000"]
				: [];

	if (!options.length) {
		return;
	}

	box.append(el("span", "chips-label", tr().tryThese));

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
	lastData = data;
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
		? tr().ended
		: s.currentRole === "identity"
			? tr().enterCode
			: tr().typeMessage;
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

// Put the page text in the chosen language.
function applyLanguage() {
	document.documentElement.lang = lang;
	$("lang-code").textContent = lang.toUpperCase();

	for (const node of document.querySelectorAll("[data-i18n]")) {
		node.textContent = tr()[node.dataset.i18n];
	}

	for (const option of document.querySelectorAll("#lang-menu [data-lang]")) {
		option.setAttribute("aria-selected", String(option.dataset.lang === lang));
	}
}

// Switch language. A chat that has only the greeting restarts in the new language.
// Otherwise the next agent replies come in the new language.
async function setLanguage(next) {
	lang = next;

	try {
		localStorage.setItem("finchpay-lang", lang);
	} catch {
		// Storage can be blocked. The choice lasts until the page reloads.
	}

	applyLanguage();

	if (lastData && lastData.messages.every((m) => m.from === "agent")) {
		await newChat();
	} else if (lastData) {
		render(lastData);
	}
}

function toggleLangMenu(open) {
	$("lang-menu").hidden = !open;
	$("lang-button").setAttribute("aria-expanded", String(open));
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
	render(await post("/api/session", { lang }));
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
		render(await post("/api/chat", { token, message, lang }));
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
	$("status").textContent = tr().resetDone;
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

$("lang-button").addEventListener("click", (e) => {
	e.stopPropagation();
	toggleLangMenu($("lang-menu").hidden);
});

for (const option of document.querySelectorAll("#lang-menu [data-lang]")) {
	option.addEventListener("click", () => {
		toggleLangMenu(false);
		setLanguage(option.dataset.lang);
	});
}

// A click anywhere else, or Escape, closes the language menu.
document.addEventListener("click", () => toggleLangMenu(false));
document.addEventListener("keydown", (e) => {
	if (e.key === "Escape") {
		toggleLangMenu(false);
	}
});

applyLanguage();
start();
