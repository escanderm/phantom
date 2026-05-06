const crypto = require('crypto');
global.WebSocket = require('ws');
const { generatePrivateKey, getPublicKey, signEvent, getEventHash, SimplePool } = require('nostr-tools');

// ── Публичные Nostr relay ──
const RELAYS = [
    'wss://relay.damus.io',
    'wss://relay.nostr.band',
    'wss://nos.lol',
    'wss://relay.snort.social',
];

const KIND_HANDSHAKE = 1; // хранится relay
const KIND_CHAT      = 1; // хранится relay, с expiration 5 мин — зашифровано

// ── UPSTASH REDIS (закомментировано, рабочий fallback) ──
// const Redis = require('ioredis');
// const REDIS_URL = 'rediss://default:gQAAAAAAAVogAAIgcDIwOGQ0YmJkZmIxMmI0NjkxOWMzNTFmZDRiNTZiYzcyMA@glowing-horse-88608.upstash.io:6379';
// const SESSION_TTL = 300;

class Session {
    constructor() {
        this.x25519Keys      = null;
        this.nostrSecret     = null;
        this.nostrPubkey     = null;
        this.fingerprint     = null;
        this.peerFingerprint = null;
        this.sharedSecret    = null;
        this._pubKeyPem      = null;
        this.pool            = null;
        this.onMessage       = null;
        this.onPeerConnected = null;
    }

    connect() {
        this.pool = new SimplePool();
    }

    generateKeys() {
        this.x25519Keys  = crypto.generateKeyPairSync('x25519');
        this.nostrSecret = generatePrivateKey();
        this.nostrPubkey = getPublicKey(this.nostrSecret);

        const pubBytes = this.x25519Keys.publicKey.export({ type: 'spki', format: 'der' });
        const hash = crypto.createHash('sha256').update(pubBytes).digest('hex');
        this.fingerprint = hash.slice(0, 6).toUpperCase();
        this._pubKeyPem  = this.x25519Keys.publicKey.export({ type: 'spki', format: 'pem' });
        return this.fingerprint;
    }

    // Хост: публикуем приглашение и слушаем seek + reply
    async startSession() {
        await this._publishHandshake();

        // Когда Боб пришлёт seek — переотправляем handshake
        const seekSub = this.pool.sub(RELAYS, [{
            kinds: [KIND_HANDSHAKE],
            '#t': [`${this.fingerprint}:seek`],
            since: Math.floor(Date.now() / 1000) - 5,
        }]);
        seekSub.on('event', async () => {
            console.log('[nostr] got seek, re-publishing handshake');
            await this._publishHandshake();
        });

        // Ждём reply от Боба с его ключом
        const replySub = this.pool.sub(RELAYS, [{
            kinds: [KIND_HANDSHAKE],
            '#t': [`${this.fingerprint}:reply`],
            since: Math.floor(Date.now() / 1000) - 5,
        }]);
        replySub.on('event', async (event) => {
            try {
                const data = JSON.parse(event.content);
                if (!data.fp || !data.pubkey) return;
                seekSub.unsub();
                replySub.unsub();
                await this._establishSession(data.pubkey, data.fp);
            } catch(e) {
                console.error('[nostr] reply parse error:', e);
            }
        });
    }

    async _publishHandshake() {
        const event = this._sign({
            kind: KIND_HANDSHAKE,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['t', this.fingerprint]],
            content: JSON.stringify({ fp: this.fingerprint, pubkey: this._pubKeyPem }),
        });
        await this._publishWithTimeout(event);
        console.log('[nostr] published handshake, fp:', this.fingerprint);
    }

    async _publishWithTimeout(event, ms = 5000) {
        await Promise.race([
            Promise.allSettled(this.pool.publish(RELAYS, event)),
            new Promise(r => setTimeout(r, ms)),
        ]);
    }

    // Боб: шлём seek каждые 2с, ждём handshake от хоста, отвечаем reply
    joinSession(fingerprint) {
        const myPubKeyPem = this._pubKeyPem;
        let done = false;

        return new Promise(async (resolve, reject) => {
            const timeout = setTimeout(() => {
                done = true;
                handshakeSub.unsub();
                reject(new Error('Сессия не найдена или истекла'));
            }, 20000);

            // Подписываемся на handshake от хоста
            const handshakeSub = this.pool.sub(RELAYS, [{
                kinds: [KIND_HANDSHAKE],
                '#t': [fingerprint],
                since: Math.floor(Date.now() / 1000) - 30,
            }]);

            handshakeSub.on('event', async (event) => {
                if (done) return;
                try {
                    const data = JSON.parse(event.content);
                    if (!data.fp || !data.pubkey) return;
                    done = true;
                    clearTimeout(timeout);
                    handshakeSub.unsub();

                    // Отвечаем своим ключом
                    const replyEvent = this._sign({
                        kind: KIND_HANDSHAKE,
                        created_at: Math.floor(Date.now() / 1000),
                        tags: [['t', `${fingerprint}:reply`]],
                        content: JSON.stringify({ fp: this.fingerprint, pubkey: myPubKeyPem }),
                    });
                    await this._publishWithTimeout(replyEvent);
                    await this._establishSession(data.pubkey, fingerprint);
                    resolve();
                } catch(e) {
                    clearTimeout(timeout);
                    reject(e);
                }
            });

            // Шлём seek каждые 2 секунды пока не подключимся
            const publishSeek = async () => {
                if (done) return;
                const seekEvent = this._sign({
                    kind: KIND_HANDSHAKE,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [['t', `${fingerprint}:seek`]],
                    content: '{}',
                });
                await this._publishWithTimeout(seekEvent);
                console.log('[nostr] published seek for fp:', fingerprint);
                if (!done) setTimeout(publishSeek, 2000);
            };

            await publishSeek();
        });
    }

    async _establishSession(peerPubKeyPem, peerFp) {
        const peerPublicKey = crypto.createPublicKey(peerPubKeyPem);

        this.sharedSecret = crypto.diffieHellman({
            privateKey: this.x25519Keys.privateKey,
            publicKey: peerPublicKey,
        });

        this.peerFingerprint = peerFp;
        console.log('[nostr] session established with:', this.peerFingerprint);

        // Подписываемся на чат
        const chatSub = this.pool.sub(RELAYS, [{
            kinds: [KIND_CHAT],
            '#t': [this._chatTag()],
            since: Math.floor(Date.now() / 1000) - 60,
        }]);
        chatSub.on('event', (event) => {
            try {
                if (!event.content || event.content.length > 60000) return;
                if (this._seenIds?.has(event.id)) return;
                this._seenIds?.add(event.id);
                const msg = JSON.parse(event.content);
                if (msg.from === this.fingerprint) return;
                const text = this._decrypt(msg.data);
                if (this.onMessage) this.onMessage(text);
            } catch(e) {}
        });

        if (this.onPeerConnected) this.onPeerConnected(this.peerFingerprint);

        // Переподписываемся каждые 30 сек на случай если relay оборвал соединение
        this._seenIds = new Set();
        this._keepalive = setInterval(() => this._resubscribeChat(), 15000);
    }

    _resubscribeChat() {
        if (!this.sharedSecret) return;
        try {
            const sub = this.pool.sub(RELAYS, [{
                kinds: [KIND_CHAT],
                '#t': [this._chatTag()],
                since: Math.floor(Date.now() / 1000) - 20,
            }]);
            sub.on('event', (event) => {
                try {
                    if (!event.content || event.content.length > 60000) return;
                    if (this._seenIds.has(event.id)) return;
                    this._seenIds.add(event.id);
                    if (this._seenIds.size > 200) {
                        const first = this._seenIds.values().next().value;
                        this._seenIds.delete(first);
                    }
                    const msg = JSON.parse(event.content);
                    if (msg.from === this.fingerprint) return;
                    const text = this._decrypt(msg.data);
                    if (this.onMessage) this.onMessage(text);
                } catch(e) {}
            });
        } catch(e) {}
    }

    async sendMessage(text) {
        const expiry = Math.floor(Date.now() / 1000) + 300;
        const event = this._sign({
            kind: KIND_CHAT,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['t', this._chatTag()], ['expiration', String(expiry)]],
            content: JSON.stringify({ from: this.fingerprint, data: this._encrypt(text) }),
        });
        await this._publishWithTimeout(event);
    }

    _chatTag() {
        return `chat:${[this.fingerprint, this.peerFingerprint].sort().join(':')}`;
    }

    _encrypt(text) {
        const key = crypto.createHash('sha256').update(this.sharedSecret).digest();
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([iv, tag, enc]).toString('base64');
    }

    _decrypt(base64) {
        const key = crypto.createHash('sha256').update(this.sharedSecret).digest();
        const buf = Buffer.from(base64, 'base64');
        const iv  = buf.slice(0, 12);
        const tag = buf.slice(12, 28);
        const enc = buf.slice(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    }

    _sign(template) {
        const event = { ...template, pubkey: this.nostrPubkey };
        event.id  = getEventHash(event);
        event.sig = signEvent(event, this.nostrSecret);
        return event;
    }

    close() {
        if (this._keepalive) clearInterval(this._keepalive);
        this.pool?.close(RELAYS);
        this.x25519Keys   = null;
        this.sharedSecret = null;
    }
}

module.exports = Session;
