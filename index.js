const {
	default: makeWASocket,
	makeCacheableSignalKeyStore,
	PHONENUMBER_MCC,
	useMultiFileAuthState,
	fetchLatestBaileysVersion,
	DisconnectReason,
} = require("@whiskeysockets/baileys");
const NodeCache = require("node-cache");
const readline = require("readline");
const fs = require("fs");
const pino = require("pino");
const axios = require("axios");
const OpenAI = require("openai");
const openai = new OpenAI({
	apiKey: "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",
});

const msgRetryCounterCache = new NodeCache();

const useStore = false; // Untuk menyimpan semua data dari bot, contoh: nomer chat grup dll, Atur false saja, karna ini membuat bot berat

const MAIN_LOGGER = pino({
	timestamp: () => `,"time":"${new Date().toJSON()}"`,
});

const logger = MAIN_LOGGER.child({});
logger.level = "trace";

const store = useStore ? makeInMemoryStore({ logger }) : undefined;
store?.readFromFile(`store.json`);

setInterval(
	() => {
		store?.writeToFile(`store.json`);
	},
	1000 * 60 * 24 * 30,
);

/* menggunakan readline sementara */
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});
const question = text => new Promise(resolve => rl.question(text, resolve));

/* fungsi ini untuk menghilangkan logger dari store */
const P = require("pino")({
	level: "silent",
});

async function startSocket() {
	let { state, saveCreds } = await useMultiFileAuthState("botSession"); // create creds session
	let { version } = await fetchLatestBaileysVersion();
	const sock = makeWASocket({
		version,
		logger: P, // P for hidden log console
		printQRInTerminal: true,
		browser: ["chrome (linux)", "", ""], // If you change this then the pairing code will not work
		auth: {
			creds: state.creds,
			keys: makeCacheableSignalKeyStore(state.keys, P),
		},
		msgRetryCounterCache,
	});
	store?.bind(sock.ev);

	sock.ev.on("creds.update", saveCreds); // to save creds

	if (!sock.authState.creds.registered) {
		const phoneNumber = await question("Enter your active whatsapp number: ");
		const code = await sock.requestPairingCode(phoneNumber);
		console.log(`pairing with this code: ${code}`);
	}

	sock.ev.on("connection.update", async update => {
		const { connection, lastDisconnect } = update;
		/*
		 * pengecekan koneksi
		 */
		if (connection === "connecting") {
			console.log("starting bot socket");
		} else if (connection === "open") {
			console.log("bot socket connected");
		} else if (connection === "close") {
			/* cek apakah koneksi terakhir telah di hapus tapi sessions masih ada, maka session bakal di hapus */
			if (lastDisconnect.error.output.statusCode == DisconnectReason.loggedOut) {
				fs.unlink("botSession", err => {
					if (err) {
						console.log("eror deleting old session");
					} else {
						console.log("delete old session successfully");
					}
				});
				process.exit(0);
			}
			/* Ketika socket terputus maka akan di hubungkan kembali */
			startSocket().catch(() => startSocket());
		}
	});

	sock.ev.on("messages.upsert", async chatUpdate => {
		const m = chatUpdate.messages[0];

		const id = m.key.remoteJid;
		const cek = m.message;
		
		const fromMe = m.key.fromMe;

		if (m.message?.conversation) {
			var nmsg = m.message.conversation.trim();
		} else if (m.message?.extendedTextMessage) {
			var exmsg = m.message.extendedTextMessage.text.trim();
		} else {
		}
		if (me) return;
		let cmd = nmsg || exmsg;
		console.log(id + ":" + cmd);

		if (id.includes("@s.whatsapp.net")) {
			sock.sendPresenceUpdate("composing", id);
			try {
				const chatCompletion = await openai.chat.completions.create({
					messages: [{ role: "assistant", content: cmd }],
					model: "gpt-3.5-turbo",
					temperature: 0.8,
					max_tokens: 50,
				});
				sock.sendMessage(id, { text: chatCompletion.choices[0].message.content });
			} catch (err) {
				console.log(err);
			}
		}
	});
}
startSocket();
