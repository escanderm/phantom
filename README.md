# ◈ Phantom

**Ephemeral · Encrypted · P2P**

A serverless encrypted messenger. No accounts. No servers. No history.  
Every session is born and dies in RAM.

![Version](https://img.shields.io/github/v/release/escanderm/phantom?style=flat-square&color=white)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-white?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-white?style=flat-square)

---

## How it works

1. **Start a session** — a keypair is generated in memory, you get a 6-character code
2. **Share the code** — send it to your peer via any channel (voice, text, whatever)
3. **Connect** — your peer enters the code, peers find each other on the DHT and connect directly
4. **Chat** — all messages encrypted end-to-end, images supported, peer presence visible (active / away / offline)
5. **Close** — session ends, everything is gone. No logs. No trace.

```
Alice                            DHT discovery                          Bob
  |                                    |                                  |
  |── join topic = sha256("phantom:" + fp) ──►|◄── join same topic ───────|
  |                                    |                                  |
  |◄═══════ direct P2P connection (hole-punched) ═══════════════════════►|
  |                                                                       |
  |═══ X25519 handshake → AES-256-GCM chat (no relay sees traffic) ══════|
```

After the DHT brings the two peers together, traffic flows **directly between them** — no intermediary holds, forwards, or sees a single byte.

---

## Security

| What | How |
|---|---|
| Discovery | Hyperswarm DHT — finds peers by topic hash, no accounts |
| Connection | Direct P2P with NAT hole-punching (Noise-encrypted by Hyperswarm) |
| Key exchange | X25519 ECDH — ephemeral, generated per session |
| Message encryption | AES-256-GCM with shared secret (on top of Noise) |
| Storage | None — everything lives in RAM only |
| Identity | None — no accounts, no phone numbers, no emails |

No server holds your keys. No server holds your messages. After DHT discovery, **there is no third party in the data path** — peers are talking to each other directly.

---

## Versions

| Version | Transport | Notes |
|---|---|---|
| **v0.4.0+** | Hyperswarm DHT | Pure P2P. No relay sees traffic. Recommended. |
| v0.3.3 | Upstash Redis pub/sub | Legacy build. Use only if DHT discovery is blocked in your network. |

Both builds are kept in [releases](../../releases) — pick whichever fits your environment.

---

## Download

→ **[Latest release](../../releases/latest)**

| Platform | File | Notes |
|---|---|---|
| macOS (Apple Silicon) | `Phantom-x.x.x-arm64.dmg` | M1 / M2 / M3 |
| macOS (Intel) | `Phantom-x.x.x-x64.dmg` | Intel chips |
| Linux | `Phantom-x.x.x.AppImage` | No installation required |
| Windows | `Phantom.Setup.x.x.x.exe` | NSIS installer |

> **macOS first launch:** right-click → Open → Open Anyway  
> Or in Terminal: `xattr -cr /Applications/Phantom.app`
>
> **Linux:** `chmod +x Phantom-*.AppImage && ./Phantom-*.AppImage`

---

## Build from source

```bash
git clone git@github.com:escanderm/phantom.git
cd phantom
npm install
npm start            # run in dev mode
npm run build:mac    # build macOS DMG (arm64 + x64)
npm run build:linux  # build Linux AppImage
npm run build:win    # build Windows installer
```

Requires Node.js 22+.

---

## Stack

- [Electron](https://electronjs.org) — desktop shell
- [Hyperswarm](https://github.com/holepunchto/hyperswarm) — DHT-based P2P discovery and hole-punching
- Node.js built-in `crypto` — X25519 + AES-256-GCM

---

## License

MIT
