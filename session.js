const crypto = require('crypto');
const Hyperswarm = require('hyperswarm');
const b4a = require('b4a');

class Session {
    constructor() {
        this.x25519Keys         = null;
        this.fingerprint        = null;
        this.peerFingerprint    = null;
        this.sharedSecret       = null;
        this._pubKeyPem         = null;
        this.swarm              = null;
        this.peerStream         = null;
        this._buffer            = null;
        this._discovery         = null;
        this.onMessage          = null;
        this.onPeerConnected    = null;
        this.onPeerDisconnected = null;
        this.onPeerPresence     = null;
    }

    async connect() {
        this.swarm = new Hyperswarm();
        this.swarm.on('connection', (conn) => this._handleConnection(conn));
    }

    generateKeys() {
        this.x25519Keys = crypto.generateKeyPairSync('x25519');
        const pubBytes  = this.x25519Keys.publicKey.export({ type: 'spki', format: 'der' });
        const hash      = crypto.createHash('sha256').update(pubBytes).digest('hex');
        this.fingerprint = hash.slice(0, 6).toUpperCase();
        this._pubKeyPem  = this.x25519Keys.publicKey.export({ type: 'spki', format: 'pem' });
        return this.fingerprint;
    }

    _topic(fp) {
        return crypto.createHash('sha256').update('phantom:' + fp).digest();
    }

    async startSession() {
        const topic = this._topic(this.fingerprint);
        this._discovery = this.swarm.join(topic, { server: true, client: false });
        await this._discovery.flushed();
    }

    async joinSession(fingerprint, { timeoutMs = 30000 } = {}) {
        const topic = this._topic(fingerprint);
        this._discovery = this.swarm.join(topic, { server: false, client: true });

        await new Promise((resolve, reject) => {
            const timer = setTimeout(async () => {
                try { await this._discovery.destroy(); } catch {}
                reject(new Error('Peer not found — session expired or invalid code'));
            }, timeoutMs);

            const onConnection = () => {
                clearTimeout(timer);
                this.swarm.off('connection', onConnection);
                resolve();
            };
            this.swarm.on('connection', onConnection);

            this.swarm.flush().catch(() => {});
        });
    }

    _handleConnection(conn) {
        if (this.peerStream) {
            // already paired with someone — drop duplicate routes
            conn.destroy();
            return;
        }
        this.peerStream = conn;
        this._buffer = b4a.alloc(0);

        conn.on('data',  (chunk) => this._handleStreamData(chunk));
        conn.on('close', ()      => this._handleStreamClose());
        conn.on('error', (err)   => console.error('[swarm] stream error:', err.message));

        // both sides immediately announce themselves; DH is symmetric so order doesn't matter
        this._sendFrame({
            type:   'hello',
            fp:     this.fingerprint,
            pubkey: this._pubKeyPem,
        });
    }

    _handleStreamData(chunk) {
        this._buffer = b4a.concat([this._buffer, chunk]);
        while (this._buffer.length >= 4) {
            const len = this._buffer.readUInt32BE(0);
            if (this._buffer.length < 4 + len) break;
            const payload = this._buffer.slice(4, 4 + len);
            this._buffer  = this._buffer.slice(4 + len);
            try {
                this._handleFrame(JSON.parse(payload.toString('utf8')));
            } catch(e) {
                console.error('[swarm] frame parse error:', e.message);
            }
        }
    }

    _handleFrame(msg) {
        if (msg.type === 'hello') {
            this._establishSession(msg.pubkey, msg.fp);
        } else if (msg.type === 'msg') {
            const text = this._decrypt(msg.data);
            if (this.onMessage) this.onMessage(text);
        } else if (msg.type === 'presence') {
            if (this.onPeerPresence) this.onPeerPresence(msg.state);
        }
    }

    _sendFrame(obj) {
        if (!this.peerStream) return;
        const payload = b4a.from(JSON.stringify(obj), 'utf8');
        const header  = b4a.alloc(4);
        header.writeUInt32BE(payload.length, 0);
        this.peerStream.write(b4a.concat([header, payload]));
    }

    _establishSession(peerPubKeyPem, peerFp) {
        if (this.sharedSecret) return; // already handshaken
        const peerPublicKey = crypto.createPublicKey(peerPubKeyPem);
        this.sharedSecret = crypto.diffieHellman({
            privateKey: this.x25519Keys.privateKey,
            publicKey:  peerPublicKey,
        });
        this.peerFingerprint = peerFp;
        console.log('[swarm] session established with:', this.peerFingerprint);
        if (this.onPeerConnected) this.onPeerConnected(this.peerFingerprint);
    }

    _handleStreamClose() {
        const wasConnected = !!this.sharedSecret;
        this.peerStream  = null;
        this._buffer     = null;
        if (wasConnected && this.onPeerDisconnected) this.onPeerDisconnected();
    }

    async sendMessage(text) {
        if (!this.peerStream) throw new Error('no peer connected');
        this._sendFrame({ type: 'msg', data: this._encrypt(text) });
    }

    sendPresence(state) {
        if (!this.peerStream) return;
        this._sendFrame({ type: 'presence', state });
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
        try { this.peerStream?.end(); } catch {}
        try { await this.swarm?.destroy(); } catch {}
        this.x25519Keys   = null;
        this.sharedSecret = null;
        this.peerStream   = null;
        this._buffer      = null;
    }
}

module.exports = Session;
