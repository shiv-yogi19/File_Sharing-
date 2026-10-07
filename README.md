# FluxDrop — Drop. Connect. Transfer.
Created By Shiv Yogi. Browser-to-browser P2P file sharing. Files never touch the server.

## Architecture
- **Transfer:** Sender browser → WebRTC DataChannel (DTLS) → Receiver browser. Files are read in 64 KB slices (`File.slice`), so a large file is never fully held in sender RAM. Backpressure uses `bufferedAmount` / `bufferedamountlow`. Each receiver has its own queue, so several receivers run concurrently with individual progress.
- **Signaling:** `src/worker.js` validates `/ws` requests and routes them to a Durable Object (`src/room.js`), one per 6-digit code. It relays only SDP/ICE text messages (>16 KB rejected). Room state is temporary (2 h alarm); it is wiped when the host leaves.
- **E2E encryption:** AES-256-GCM per chunk (`src/crypto.js`), IV = peer-salt|file|counter, AAD binds file+counter (reorder/replay fails). The key is generated in the sender browser and shared in the **URL fragment** (`/#j=CODE&k=KEY`, never sent to servers). If someone joins with only the 6-digit code, the key arrives over the DTLS DataChannel — a malicious signaling server could theoretically MITM that path; use the share link/QR-style link for the strongest guarantee. The join code is NOT the key.
- **Identity:** `FD-XXXX-XXXX` generated in-browser, stored in localStorage, expires after 48 h (UI + sessions closed). The server checks format and the claimed expiry only; there is no account database, so expiry is client-enforced (cannot be tamper-proof without server state).
- **Watermark:** `src/watermark.js` — JPG/PNG/WebP via Canvas, producing a new file (`name_FluxDrop.ext`). PDF, video, ZIP/APK/EXE etc. are sent as untouched originals (not implemented; UI says so). Disable in Settings.

## Run / deploy
```
npm install
npx wrangler dev        # local
npx wrangler deploy     # deploy (runs the build step that copies src/crypto.js + src/watermark.js into public/)
```
Durable Object migration (`new_sqlite_classes: ["Room"]`) is in `wrangler.jsonc`. No secrets are used. Optional TURN: set `localStorage.fd_ice = '[{"urls":"turn:host:3478","username":"u","credential":"c"}]'` (short-lived credentials recommended; never commit permanent secrets).

## Browser support
Chrome/Edge/Firefox/Safari with WebRTC + Web Crypto, HTTPS required. Android Chrome is the main target.

## Known limitations
- Receivers buffer the file in memory until it finishes, then save (very large files can fail on low-RAM phones; error is shown). No streaming-to-disk or resume: if the connection drops the transfer fails and must be restarted.
- Without TURN, some strict NATs cannot connect.
- Practical peer count depends on sender CPU/bandwidth; no fixed limit is enforced, errors surface per receiver.
- QR code not included.
- Multiple automatic downloads may require allowing "multiple downloads" in the browser.

## Test checklist
Phone→Phone; Phone→2 phones; multiple files; large file (500 MB+); image watermark (check bottom-right text); PDF/ZIP arrive byte-identical; invalid code (000000); expired room (host leaves, then join); identity expiry (set `fd_id.exp` in localStorage to a past time, wait ≤15 s); refresh during transfer (fails, restart); sender/receiver disconnect (state shows); toggle airplane mode (Reconnecting/Failed); Android Chrome, desktop Chrome, Android TV browser (D-pad navigation); throttled network; transfer completes and file saves.
