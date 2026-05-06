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
3. **Connect** — your peer enters the code, keys are exchanged, session begins
4. **Chat** — all messages encrypted end-to-end, images supported
5. **Close** — session ends, everything is gone. No logs. No trace.

```
Alice                          Nostr relay                        Bob
  |                                 |                              |
  |── publishes session code ──────►|                              |
  |                                 |◄── seek ─────────────────────|
  |◄── re-publishes handshake ──────|                              |
  |                                 |── handshake ────────────────►|
  |◄── reply with Bob's pubkey ─────|                              |
  |                                 |                              |
  |════════ E2E encrypted chat (AES-256-GCM) ════════════════════|
```

---

## Security

| What | How |
|---|---|
| Key exchange | X25519 ECDH — ephemeral, generated per session |
| Message encryption | AES-256-GCM with shared secret |
| Transport | Nostr public relays — no registration, no ownership |
| Storage | None — everything lives in RAM only |
| Identity | None — no accounts, no phone numbers, no emails |

No server holds your keys. No server holds your messages.  
The relay sees only encrypted blobs and doesn't know who you are.

---

## Download

→ **[Latest release](../../releases/latest)**

| Platform | File | Notes |
|---|---|---|
| macOS | `Phantom-x.x.x-universal.dmg` | Apple Silicon + Intel |
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
npm start          # run in dev mode
npm run build      # build DMG
```

Requires Node.js 18+.

---

## Stack

- [Electron](https://electronjs.org) — desktop shell
- [nostr-tools](https://github.com/nbd-wtf/nostr-tools) — P2P relay transport
- Node.js built-in `crypto` — X25519 + AES-256-GCM

---

## License

MIT
