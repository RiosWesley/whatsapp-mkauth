require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');

// Configuration
const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 3000;
const AUTH_ACCOUNT = process.env.AUTH_ACCOUNT || process.env.MK_AUTH_ACCOUNT || process.env.CONTA || '';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || process.env.MK_AUTH_PASSWORD || process.env.SENHA || '';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// WhatsApp client state
let clientStatus = 'initializing'; // initializing | qr | ready | disconnected
let lastQrText = null;
const messageStatusMap = new Map(); // messageId -> { ack, to, type, createdAt }

// Initialize WhatsApp client with persistent auth
const client = new Client({
	authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
	puppeteer: {
		headless: true,
		executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
		args: [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--disable-dev-shm-usage',
			'--no-first-run',
			'--no-zygote',
			'--disable-gpu',
			'--single-process'
		]
	}
});

client.on('qr', (qr) => {
	clientStatus = 'qr';
	lastQrText = qr;
	qrcode.generate(qr, { small: true });
	console.log('[whatsapp] QR gerado. Escaneie para autenticar.');
});

client.on('ready', () => {
	clientStatus = 'ready';
	console.log('[whatsapp] Cliente pronto.');
});

client.on('authenticated', () => {
	console.log('[whatsapp] Autenticado.');
});

client.on('auth_failure', (msg) => {
	clientStatus = 'disconnected';
	console.error('[whatsapp] Falha de autenticação:', msg);
});

client.on('loading_screen', (percent, message) => {
    console.log(`[whatsapp] Carregando ${percent}% - ${message}`);
});

client.on('change_state', (state) => {
    console.log('[whatsapp] Estado:', state);
});

client.on('disconnected', (reason) => {
    clientStatus = 'disconnected';
    console.error('[whatsapp] Desconectado:', reason);
    // Reinicializa com limpeza para evitar dupla injeção no mesmo Page
    setTimeout(async () => {
        try { await client.destroy(); } catch (_) {}
        try { await client.initialize(); } catch (_) {}
    }, 5000);
});

// Loga ACKs de mensagens enviadas
client.on('message_ack', (msg, ack) => {
    try {
        const id = msg?.id?._serialized || null;
        const to = msg?.to || null;
        const payload = { id, to, ack };
        appendJsonLog('outgoing-ack', payload);
        if (id) {
            const prev = messageStatusMap.get(id) || { createdAt: new Date().toISOString() };
            messageStatusMap.set(id, { ...prev, ack, to, type: msg?.type || prev.type });
        }
    } catch (_) {}
});

console.log('[whatsapp] Inicializando cliente WhatsApp...');
client.initialize().catch((e) => {
    console.error('[whatsapp] Erro ao inicializar:', e);
});

// Watchdog: alerta se demorar demais
setTimeout(() => {
    if (clientStatus === 'initializing') {
        console.warn('[whatsapp] Ainda inicializando após 60s. Verifique Chromium e rede.');
    }
}, 60000);

// Helpers
function normalizePhoneToWhatsAppId(rawPhone) {
	if (!rawPhone) return null;
	let digits = String(rawPhone).replace(/\D/g, '');
    // Tratamento Brasil: remover o dígito 9 após o DDD quando presente
    // Casos aceitos:
    // - Sem DDI: 11 dígitos (DDI ausente) => 2 DDD + 9 + 8; removemos o 9 e depois prefixamos 55
    if (digits.length === 11) {
        // DDD: 2 primeiros dígitos, se o 3º for 9, remove
        if (digits[2] === '9') {
            digits = digits.slice(0, 2) + digits.slice(3); // remove o 9
        }
        digits = '55' + digits;
    }
    // - Com DDI: 13 dígitos iniciando por 55 => 55 + 2 DDD + 9 + 8; removemos o 9 após o DDD
    if (digits.length === 13 && digits.startsWith('55') && digits[4] === '9') {
        digits = digits.slice(0, 4) + digits.slice(5); // remove o 9 após DDD
    }
	if (!digits.endsWith('@c.us')) digits = `${digits}@c.us`;
	return digits;
}

async function bufferFromUrl(fileUrl) {
	const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
	return Buffer.from(response.data);
}

function readBasicAuth(req) {
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Basic ')) return { account: null, password: null };
    try {
        const decoded = Buffer.from(header.replace('Basic ', ''), 'base64').toString('utf8');
        const [account, password] = decoded.split(':');
        return { account, password };
    } catch (_) {
        return { account: null, password: null };
    }
}

function checkMkAuth(req, res, next) {
    // Aceita Basic Auth ou conta/senha via header/body/query
    const basic = readBasicAuth(req);
    const account = (basic.account || req.headers['conta'] || req.headers['account'] || req.body?.login || req.body?.conta || req.body?.account || req.query?.login || req.query?.conta || req.query?.account || '').toString();
    const password = (basic.password || req.headers['senha'] || req.headers['password'] || req.body?.pass || req.body?.senha || req.body?.password || req.query?.pass || req.query?.senha || req.query?.password || '').toString();

    if (!AUTH_ACCOUNT && !AUTH_PASSWORD) {
        // Sem credenciais configuradas, não exige auth
        return next();
    }

    if (account === AUTH_ACCOUNT && password === AUTH_PASSWORD) {
        return next();
    }

    return res.status(401).json({ success: false, error: 'unauthorized' });
}

function getField(obj, names, fallback = undefined) {
    for (const name of names) {
        if (obj && Object.prototype.hasOwnProperty.call(obj, name) && obj[name] != null) {
            return obj[name];
        }
    }
    return fallback;
}

// Logging util (JSONL diário)
function appendJsonLog(filePrefix, payload) {
    try {
        const logsDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);
        const date = new Date();
        const day = date.toISOString().slice(0, 10); // YYYY-MM-DD
        const filePath = path.join(logsDir, `${filePrefix}-${day}.log`);
        const record = { timestamp: date.toISOString(), ...payload };
        fs.appendFileSync(filePath, JSON.stringify(record) + '\n');
    } catch (e) {
        console.error('appendJsonLog error', e);
    }
}

// Routes
app.get('/status', async (req, res) => {
	res.json({ status: clientStatus, qr: clientStatus === 'qr' ? lastQrText : null });
});

// Endpoint de captura para descobrir o payload do MK-AUTH
app.all('/mk-capture', upload.single('file'), async (req, res) => {
    const entry = {
        method: req.method,
        path: req.path,
        headers: req.headers,
        query: req.query,
        body: req.body,
        file: req.file ? { fieldname: req.file.fieldname, originalname: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size } : null
    };
    appendJsonLog('mk-auth', entry);
    res.json({ received: true, hint: 'Verifique logs/mk-auth-YYYY-MM-DD.log' });
});

// POST /send-message { number, message }
app.post('/send-message', checkMkAuth, async (req, res) => {
	try {
		if (clientStatus !== 'ready') {
			return res.status(409).json({ success: false, error: 'whatsapp_not_ready', status: clientStatus });
		}
        // Prioriza MK-AUTH: to, msg; mantém aliases como fallback
        const number = getField(req.body || {}, ['to', 'number', 'numero', 'telefone', 'phone', 'destino']);
        const message = getField(req.body || {}, ['msg', 'message', 'mensagem', 'text', 'body', 'conteudo']);
		if (!number || !message) return res.status(400).json({ success: false, error: 'number_and_message_required' });
        const chatId = normalizePhoneToWhatsAppId(number);
        const registered = await client.isRegisteredUser(chatId.replace('@c.us','@c.us'));
        if (!registered) return res.status(422).json({ success: false, error: 'number_not_on_whatsapp', number });
        const sent = await client.sendMessage(chatId, message);
        const id = sent?.id?._serialized;
        appendJsonLog('outgoing', { endpoint: 'send-message', to: number, id });
        if (id) messageStatusMap.set(id, { ack: 0, to: number, type: 'chat', createdAt: new Date().toISOString() });
        return res.json({ success: true, id });
	} catch (err) {
		console.error('send-message error', err);
		return res.status(500).json({ success: false, error: 'internal_error' });
	}
});

// POST /send-image multipart/form-data (file) ou JSON { number, url, caption }
// aceita tanto multipart quanto x-www-form-urlencoded/json; procura campo 'image'
app.post('/send-image', checkMkAuth, upload.any(), async (req, res) => {
	try {
		if (clientStatus !== 'ready') {
			return res.status(409).json({ success: false, error: 'whatsapp_not_ready', status: clientStatus });
		}
        const number = getField(req.body || {}, ['to', 'number', 'numero', 'telefone', 'phone', 'destino']);
		if (!number) return res.status(400).json({ success: false, error: 'number_required' });
        const chatId = normalizePhoneToWhatsAppId(number);
        const registered = await client.isRegisteredUser(chatId.replace('@c.us','@c.us'));
        if (!registered) return res.status(422).json({ success: false, error: 'number_not_on_whatsapp', number });

		let mediaBuffer = null;
        let mimeType = getField(req.body || {}, ['mimetype', 'contentType', 'tipo'], 'image/png');
        let filename = getField(req.body || {}, ['filename', 'nome', 'nome_arquivo'], 'image.png');
        // procura arquivo nos campos image/file
        const fileImage = Array.isArray(req.files) ? req.files.find(f => ['image', 'file'].includes(f.fieldname)) : null;
        if (fileImage && fileImage.buffer) {
            mediaBuffer = fileImage.buffer;
            mimeType = fileImage.mimetype || mimeType;
            filename = fileImage.originalname || filename;
        } else if (getField(req.body || {}, ['image', 'url', 'link'])) {
            const url = getField(req.body || {}, ['image', 'url', 'link']);
            mediaBuffer = await bufferFromUrl(url);
            filename = getField(req.body || {}, ['filename', 'nome', 'nome_arquivo'], filename);
            mimeType = getField(req.body || {}, ['mimetype', 'contentType', 'tipo'], mimeType);
		} else {
			return res.status(400).json({ success: false, error: 'file_or_url_required' });
		}

		const media = new MessageMedia(mimeType, mediaBuffer.toString('base64'), filename);
        const caption = getField(req.body || {}, ['caption', 'legenda', 'descricao'], '');
        const sent = await client.sendMessage(chatId, media, { caption });
        const id = sent?.id?._serialized;
        appendJsonLog('outgoing', { endpoint: 'send-image', to: number, id, filename });
        if (id) messageStatusMap.set(id, { ack: 0, to: number, type: 'image', createdAt: new Date().toISOString() });
        return res.json({ success: true, id });
	} catch (err) {
		console.error('send-image error', err);
		return res.status(500).json({ success: false, error: 'internal_error' });
	}
});

// POST /send-document multipart/form-data (file) ou JSON { number, url, filename, mimetype, caption }
// aceita multipart e x-www-form-urlencoded/json; procura campo 'document'
app.post('/send-document', checkMkAuth, upload.any(), async (req, res) => {
	try {
		if (clientStatus !== 'ready') {
			return res.status(409).json({ success: false, error: 'whatsapp_not_ready', status: clientStatus });
		}
        const number = getField(req.body || {}, ['to', 'number', 'numero', 'telefone', 'phone', 'destino']);
		if (!number) return res.status(400).json({ success: false, error: 'number_required' });
        const chatId = normalizePhoneToWhatsAppId(number);
        const registered = await client.isRegisteredUser(chatId.replace('@c.us','@c.us'));
        if (!registered) return res.status(422).json({ success: false, error: 'number_not_on_whatsapp', number });

		let mediaBuffer = null;
        let mimeType = getField(req.body || {}, ['mimetype', 'contentType', 'tipo'], 'application/pdf');
        let filename = getField(req.body || {}, ['filename', 'nome', 'nome_arquivo'], 'document.pdf');
        const fileDoc = Array.isArray(req.files) ? req.files.find(f => ['document', 'file'].includes(f.fieldname)) : null;
        if (fileDoc && fileDoc.buffer) {
            mediaBuffer = fileDoc.buffer;
            mimeType = fileDoc.mimetype || mimeType;
            filename = fileDoc.originalname || filename;
        } else if (getField(req.body || {}, ['document', 'url', 'link'])) {
            const url = getField(req.body || {}, ['document', 'url', 'link']);
            mediaBuffer = await bufferFromUrl(url);
		} else {
			return res.status(400).json({ success: false, error: 'file_or_url_required' });
		}

		const media = new MessageMedia(mimeType, mediaBuffer.toString('base64'), filename);
        const caption = getField(req.body || {}, ['caption', 'legenda', 'descricao'], '');
        const sent = await client.sendMessage(chatId, media, { caption });
        const id = sent?.id?._serialized;
        appendJsonLog('outgoing', { endpoint: 'send-document', to: number, id, filename });
        if (id) messageStatusMap.set(id, { ack: 0, to: number, type: 'document', createdAt: new Date().toISOString() });
        return res.json({ success: true, id });
	} catch (err) {
		console.error('send-document error', err);
		return res.status(500).json({ success: false, error: 'internal_error' });
	}
});

// Health
app.get('/', (req, res) => {
	res.json({ ok: true, service: 'cobranca-zap', status: clientStatus });
});

// Consulta simples do status de uma mensagem enviada
app.get('/message-status', (req, res) => {
    const id = req.query.id;
    if (!id) return res.status(400).json({ success: false, error: 'id_required' });
    const info = messageStatusMap.get(id);
    if (!info) return res.status(404).json({ success: false, error: 'not_found' });
    return res.json({ success: true, id, ...info });
});

// Verifica se um número está no WhatsApp
app.get('/check-number', async (req, res) => {
    try {
        const number = req.query.to || req.query.number;
        if (!number) return res.status(400).json({ success: false, error: 'number_required' });
        const chatId = normalizePhoneToWhatsAppId(number);
        const registered = await client.isRegisteredUser(chatId.replace('@c.us','@c.us'));
        return res.json({ success: true, number, registered });
    } catch (e) {
        return res.status(500).json({ success: false, error: 'internal_error' });
    }
});

app.listen(PORT, () => {
	console.log(`[server] Rodando em http://localhost:${PORT}`);
});


// Encerramento limpo
process.on('SIGINT', async () => {
    try { await client.destroy(); } catch (_) {}
    process.exit(0);
});
process.on('SIGTERM', async () => {
    try { await client.destroy(); } catch (_) {}
    process.exit(0);
});
