const crypto = require('crypto');
const Redis = require('ioredis');

const REDIS_URL = 'rediss://default:gQAAAAAAAVogAAIgcDIwOGQ0YmJkZmIxMmI0NjkxOWMzNTFmZDRiNTZiYzcyMA@glowing-horse-88608.upstash.io:6379';
const SESSION_TTL = 300;

// ── NOSTR (закомментировано — relay слишком ненадёжны для persistent сессий) ──
// const { generatePrivateKey, getPublicKey, signEvent, getEventHash, SimplePool } = require('nostr-tools');
// const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];

class Session {
    constructor() {
        this.x25519Keys      = null;
        this.fingerprint     = null;
        this.peerFingerprint = null;
        this.sharedSecret    = null;
        this._pubKeyPem      = null;
        this.redis           = null;
        this.sub             = null;
        this.onMessage       = null;
        this.onPeerConnected = null;
        this._seenIds        = new Set();
    }

    async connect() {
        this.redis = new Redis(REDIS_URL);
        this.sub   = new Redis(REDIS_URL);
    }

    generateKeys() {
        this.x25519Keys = crypto.generateKeyPairSync('x25519');
        const pubBytes  = this.x25519Keys.publicKey.export({ type: 'spki', format: 'der' });
        const hash      = crypto.createHash('sha256').update(pubBytes).digest('hex');
        this.fingerprint = hash.slice(0, 6).toUpperCase();
        this._pubKeyPem  = this.x25519Keys.publicKey.export({ type: 'spki', format: 'pem' });
        return this.fingerprint;
    }

    async startSession() {
        await this.redis.set(`phantom:${this.fingerprint}`, this._pubKeyPem, 'EX', SESSION_TTL);

        await this.sub.subscribe(`phantom:peer:${this.fingerprint}`);
        this.sub.on('message', async (channel, message) => {
            try {
                if (channel === `phantom:peer:${this.fingerprint}`) {
                    const data = JSON.parse(message);
                    await this._establishSession(data.pubkey, data.fp);
                } else {
                    this._handleIncoming(message);
                }
            } catch(e) { console.error('[redis] message error:', e); }
        });
    }

    async joinSession(fingerprint) {
        const peerPubKeyPem = await this.redis.get(`phantom:${fingerprint}`);
        if (!peerPubKeyPem) throw new Error('Session not found or expired');

        const replyPayload = JSON.stringify({ fp: this.fingerprint, pubkey: this._pubKeyPem });
        await this.redis.publish(`phantom:peer:${fingerprint}`, replyPayload);
        await this.redis.del(`phantom:${fingerprint}`);

        // Ставим обработчик сообщений (у хоста он в startSession, у джойнера — здесь)
        this.sub.on('message', (channel, message) => {
            try { this._handleIncoming(message); } catch(e) {}
        });

        await this._establishSession(peerPubKeyPem, fingerprint);
    }

    async _establishSession(peerPubKeyPem, peerFp) {
        const peerPublicKey = crypto.createPublicKey(peerPubKeyPem);
        this.sharedSecret = crypto.diffieHellman({
            privateKey: this.x25519Keys.privateKey,
            publicKey: peerPublicKey,
        });
        this.peerFingerprint = peerFp;
        console.log('[redis] session established with:', this.peerFingerprint);

        const chatChannel = this._chatChannel();
        await this.sub.subscribe(chatChannel);

        if (this.onPeerConnected) this.onPeerConnected(this.peerFingerprint);
    }

    _handleIncoming(raw) {
        try {
            const msg = JSON.parse(raw);
            if (msg.from === this.fingerprint) return;
            if (this._seenIds.has(msg.id)) return;
            if (msg.id) this._seenIds.add(msg.id);
            const text = this._decrypt(msg.data);
            if (this.onMessage) this.onMessage(text);
        } catch(e) {}
    }

    async sendMessage(text) {
        const id = crypto.randomBytes(8).toString('hex');
        await this.redis.publish(this._chatChannel(), JSON.stringify({
            from: this.fingerprint,
            id,
            data: this._encrypt(text),
        }));
    }

    _chatChannel() {
        return `phantom:chat:${[this.fingerprint, this.peerFingerprint].sort().join(':')}`;
    }

    _encrypt(text) {
        const key = crypto.createHash('sha256').update(this.sharedSecret).digest();
        const iv  = crypto.randomBytes(12);
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

    async close() {
        await this.redis?.quit();
        await this.sub?.quit();
        this.x25519Keys   = null;
        this.sharedSecret = null;
    }
}

module.exports = Session;
