// Everything the agents say to the customer, in English, Spanish and French.
// The trace stays in English: it is an engineering log, not customer text.

export const LANGS = ["en", "es", "fr"];

const LOCALES = { en: "en-US", es: "es-ES", fr: "fr-FR" };

// Pick a supported language, or English.
export function pickLang(value) {
	return LANGS.includes(value) ? value : "en";
}

// 2500 cents -> "$25.00", "25,00 US$", "25,00 $US".
export function formatAmount(lang, cents, currency = "USD") {
	return new Intl.NumberFormat(LOCALES[pickLang(lang)], { style: "currency", currency }).format(
		cents / 100,
	);
}

const TEXT = {
	en: {
		greeting: () =>
			"Hi, this is the FinchPay refund desk. Which charge would you like refunded?",
		askCharge: () =>
			"I can help with a refund. Which charge is it? Charge IDs look like CH-101.",
		whichCharge: () => "Which charge would you like refunded? Charge IDs look like CH-101.",
		whichOfTwo: (ids) => `You mentioned ${ids.join(" and ")}. Which one should I refund?`,
		notFound: (id) =>
			`I couldn't find a charge called ${id}. Please check the ID and send it again.`,
		askCode: () =>
			"Before I refund this charge I need to verify your identity. Please enter the 4 digit code we sent to your phone.",
		codeOnly: () =>
			"I need the 4 digit verification code to continue. Please type just the code.",
		manyCodes: (codes) =>
			`I see more than one 4 digit number (${codes.join(", ")}). Please send just the verification code.`,
		wrongCode: (left) =>
			`That code didn't match, so I couldn't verify your identity. You have ${left} ${left === 1 ? "try" : "tries"} left. Please enter the code again.`,
		lockedNow: (minutes) =>
			`That code didn't match and there are no tries left. Verification for this charge is locked for ${minutes} minutes. No refund was issued.`,
		locked: (minutes) =>
			`Verification for this charge is locked after too many wrong codes. Please try again in ${minutes} minutes. No refund was issued.`,
		verifyError: () => "Something went wrong during verification. No refund was issued.",
		refunded: (amount, charge, ref) =>
			`Done. I refunded ${amount} for ${charge}. Your refund reference is ${ref}.`,
		refundFailed: (reason) =>
			`I couldn't issue the refund because ${reason}. No refund was issued.`,
		reasons: {
			identity_not_verified: "your identity isn't verified in this chat",
			already_refunded: "this charge has already been refunded",
			unknown_charge: "I couldn't find that charge",
		},
		closed: () =>
			"Your refund request is closed. Please start a new chat if you need anything else.",
		blocked: () => "Something went wrong on our side. No changes were made.",
		stuck: () => "Sorry, I got stuck handling that. Please start a new chat.",
		tooLong: () => "This chat has gone on too long. Please start a new chat.",
	},

	es: {
		greeting: () =>
			"Hola, este es el servicio de reembolsos de FinchPay. ¿Qué cargo quieres que te reembolsemos?",
		askCharge: () =>
			"Puedo ayudarte con un reembolso. ¿De qué cargo se trata? Los cargos se ven así: CH-101.",
		whichCharge: () => "¿Qué cargo quieres que te reembolsemos? Los cargos se ven así: CH-101.",
		whichOfTwo: (ids) => `Mencionaste ${ids.join(" y ")}. ¿Cuál debo reembolsar?`,
		notFound: (id) =>
			`No encontré ningún cargo llamado ${id}. Revisa el código y vuelve a enviarlo.`,
		askCode: () =>
			"Antes de reembolsar este cargo necesito verificar tu identidad. Escribe el código de 4 dígitos que enviamos a tu teléfono.",
		codeOnly: () =>
			"Necesito el código de verificación de 4 dígitos para continuar. Escribe solo el código.",
		manyCodes: (codes) =>
			`Veo más de un número de 4 dígitos (${codes.join(", ")}). Envía solo el código de verificación.`,
		wrongCode: (left) =>
			`Ese código no coincide, así que no pude verificar tu identidad. Te ${left === 1 ? "queda 1 intento" : `quedan ${left} intentos`}. Escribe el código de nuevo.`,
		lockedNow: (minutes) =>
			`Ese código no coincide y no quedan intentos. La verificación de este cargo queda bloqueada durante ${minutes} minutos. No se hizo ningún reembolso.`,
		locked: (minutes) =>
			`La verificación de este cargo está bloqueada por demasiados códigos incorrectos. Vuelve a intentarlo en ${minutes} minutos. No se hizo ningún reembolso.`,
		verifyError: () => "Algo salió mal durante la verificación. No se hizo ningún reembolso.",
		refunded: (amount, charge, ref) =>
			`Listo. Reembolsé ${amount} del cargo ${charge}. Tu número de reembolso es ${ref}.`,
		refundFailed: (reason) =>
			`No pude hacer el reembolso porque ${reason}. No se hizo ningún reembolso.`,
		reasons: {
			identity_not_verified: "tu identidad no está verificada en este chat",
			already_refunded: "este cargo ya fue reembolsado",
			unknown_charge: "no encontré ese cargo",
		},
		closed: () =>
			"Tu solicitud de reembolso está cerrada. Abre un chat nuevo si necesitas algo más.",
		blocked: () => "Algo salió mal de nuestro lado. No se hizo ningún cambio.",
		stuck: () => "Lo siento, me atasqué con eso. Abre un chat nuevo, por favor.",
		tooLong: () => "Este chat ya es demasiado largo. Abre un chat nuevo, por favor.",
	},

	fr: {
		greeting: () =>
			"Bonjour, ici le service de remboursement FinchPay. Quel prélèvement voulez-vous faire rembourser ?",
		askCharge: () =>
			"Je peux vous aider pour un remboursement. De quel prélèvement s'agit-il ? Les références ressemblent à CH-101.",
		whichCharge: () =>
			"Quel prélèvement voulez-vous faire rembourser ? Les références ressemblent à CH-101.",
		whichOfTwo: (ids) => `Vous avez cité ${ids.join(" et ")}. Lequel dois-je rembourser ?`,
		notFound: (id) =>
			`Je n'ai trouvé aucun prélèvement nommé ${id}. Vérifiez la référence et renvoyez-la.`,
		askCode: () =>
			"Avant de rembourser ce prélèvement, je dois vérifier votre identité. Saisissez le code à 4 chiffres envoyé sur votre téléphone.",
		codeOnly: () =>
			"J'ai besoin du code de vérification à 4 chiffres pour continuer. Saisissez seulement le code.",
		manyCodes: (codes) =>
			`Je vois plusieurs nombres à 4 chiffres (${codes.join(", ")}). Envoyez seulement le code de vérification.`,
		wrongCode: (left) =>
			`Ce code ne correspond pas, je n'ai donc pas pu vérifier votre identité. Il vous ${left === 1 ? "reste 1 essai" : `reste ${left} essais`}. Saisissez à nouveau le code.`,
		lockedNow: (minutes) =>
			`Ce code ne correspond pas et il ne reste plus d'essais. La vérification de ce prélèvement est bloquée pendant ${minutes} minutes. Aucun remboursement n'a été effectué.`,
		locked: (minutes) =>
			`La vérification de ce prélèvement est bloquée après trop de codes erronés. Réessayez dans ${minutes} minutes. Aucun remboursement n'a été effectué.`,
		verifyError: () =>
			"Un problème est survenu pendant la vérification. Aucun remboursement n'a été effectué.",
		refunded: (amount, charge, ref) =>
			`C'est fait. J'ai remboursé ${amount} pour ${charge}. Votre référence de remboursement est ${ref}.`,
		refundFailed: (reason) =>
			`Je n'ai pas pu effectuer le remboursement car ${reason}. Aucun remboursement n'a été effectué.`,
		reasons: {
			identity_not_verified: "votre identité n'est pas vérifiée dans ce chat",
			already_refunded: "ce prélèvement a déjà été remboursé",
			unknown_charge: "je n'ai pas trouvé ce prélèvement",
		},
		closed: () =>
			"Votre demande de remboursement est close. Ouvrez un nouveau chat si vous avez besoin d'autre chose.",
		blocked: () => "Un problème est survenu de notre côté. Aucune modification n'a été faite.",
		stuck: () =>
			"Désolé, je suis bloqué sur cette demande. Ouvrez un nouveau chat, s'il vous plaît.",
		tooLong: () => "Ce chat est devenu trop long. Ouvrez un nouveau chat, s'il vous plaît.",
	},
};

// The text set for one session's language.
export function t(session) {
	return TEXT[pickLang(session?.lang)];
}

// The language name the Claude prompt uses for its clarifying question.
export const LANG_NAMES = { en: "English", es: "Spanish", fr: "French" };
