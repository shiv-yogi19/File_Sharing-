import { genKey, exportKey, importKey, encryptChunk, decryptChunk, identityId, joinCode } from './crypto.js';
import { watermarkImage, canWatermark } from './watermark.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const LIFE = 48 * 36e5, CH = 64 * 1024, HI = 1 << 20;
const mem = {};
const st = {
  g: k => { try { return localStorage.getItem(k); } catch { return mem[k] ?? null; } },
  s: (k, v) => { try { localStorage.setItem(k, v); } catch { mem[k] = v; } },
  d: k => { try { localStorage.removeItem(k); } catch { delete mem[k]; } }
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = n => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return n.toFixed(i ? 2 : 0) + ' ' + u[i]; };
const mmss = s => { s = Math.max(0, Math.round(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const icon = t => t.startsWith('video') ? '🎬' : t.startsWith('image') ? '🖼' : t === 'application/pdf' ? '📄' : t.startsWith('audio') ? '🎵' : '📦';
const bar = p => `<div class="bar"><i style="width:${Math.min(100, p).toFixed(1)}%"></i></div>`;
const show = n => $$('.screen').forEach(e => e.hidden = e.id !== n);
let toastT; const toast = (m, ms = 4500) => { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms); };
const ERR = { invalid: 'Invalid Room Code', expired: 'This room has expired.', identity: 'Identity Expired', net: 'Connection failed. Check your network and try again.', taken: 'Could not create room, try again.' };

let me = null, files = [], sess = null, ticker = null, back = 'dash';
const iceServers = () => { let extra = []; try { extra = JSON.parse(st.g('fd_ice') || '[]'); } catch {} // optional TURN, set in localStorage 'fd_ice'
  return { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }, ...extra] }; };

/* ---------- identity ---------- */
function boot() {
  if (!window.RTCPeerConnection || !crypto?.subtle) toast('WebRTC / Web Crypto is not supported in this browser. Use a recent Chrome.', 12000);
  try { me = JSON.parse(st.g('fd_id')); } catch { me = null; }
  if (me && me.exp > Date.now()) return enter();
  if (me) { expire(); return; }
  splash();
}
async function splash() {
  show('splash'); const el = $('#st'); let skip = false; document.body.onclick = () => skip = true;
  for (const [t, d] of [['WELCOME', 1600], ['FLUXDROP', 1800], ['Drop. Connect. Transfer.', 1600], ['Created By Shiv Yogi', 1800]]) {
    if (skip) break; el.textContent = t; el.className = 'in'; await sleep(d); el.className = 'out'; await sleep(450);
  }
  document.body.onclick = null; show('onboard'); $('#nm').focus();
}
$('#nf').onsubmit = e => {
  e.preventDefault(); const name = $('#nm').value.trim().slice(0, 24); if (!name) return;
  me = { id: identityId(), name, exp: Date.now() + LIFE }; st.s('fd_id', JSON.stringify(me)); enter();
};
function enter() {
  go('dash'); clearInterval(ticker); ticker = setInterval(tick, 15000); tick();
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('j')) { $('#jc').value = h.get('j'); go('join'); }
}
function left() { const m = Math.max(0, Math.floor((me.exp - Date.now()) / 6e4)); return `${Math.floor(m / 60)}h ${m % 60}m`; }
function tick() {
  if (!me) return; if (me.exp <= Date.now()) return expire();
  $('#me-id').textContent = me.id; $('#me-left').textContent = left() + ' remaining'; $('#i-id').textContent = me.id; $('#i-left').textContent = 'Identity expires in ' + left();
}
function expire() { closeSess(); st.d('fd_id'); me = null; clearInterval(ticker); toast('Identity Expired. Create a new identity to continue.', 8000); show('onboard'); }
$('#b-reset').onclick = () => { closeSess(); st.d('fd_id'); me = null; location.hash = ''; location.reload(); };
function go(n) { if (n !== 'info') back = n === 'dash' ? 'dash' : back; show(n); }
$$('[data-back]').forEach(b => b.onclick = () => go('dash'));
$$('[data-info]').forEach(b => b.onclick = () => { $$('#info [id^=i-]').forEach(d => d.hidden = d.id !== 'i-' + b.dataset.info); tick(); show('info'); });
$('#s-wm').checked = st.g('fd_wm') !== '0'; $('#s-wm').onchange = e => st.s('fd_wm', e.target.checked ? '1' : '0');

/* ---------- file selection ---------- */
$('#b-drop').onclick = () => { go('drop'); renderFiles(); };
$('#b-join').onclick = () => { go('join'); $('#jc').focus(); };
$('#zone').onclick = () => $('#pick').click();
$('#zone').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#pick').click(); } };
$('#pick').onchange = e => { files.push(...e.target.files); e.target.value = ''; renderFiles(); };
['dragenter', 'dragover'].forEach(t => $('#zone').addEventListener(t, e => { e.preventDefault(); $('#zone').classList.add('over'); }));
['dragleave', 'drop'].forEach(t => $('#zone').addEventListener(t, e => { e.preventDefault(); $('#zone').classList.remove('over'); }));
$('#zone').addEventListener('drop', e => { files.push(...[...e.dataTransfer.files].filter(f => f.size >= 0)); renderFiles(); });
function renderFiles() {
  $('#flist').innerHTML = files.map((f, i) => `<li><span>${icon(f.type)} ${esc(f.name)}<br><small>${fmt(f.size)}</small></span><button aria-label="Remove ${esc(f.name)}" data-i="${i}">✕</button></li>`).join('');
  $$('#flist button').forEach(b => b.onclick = () => { files.splice(+b.dataset.i, 1); renderFiles(); });
  const t = files.reduce((a, f) => a + f.size, 0);
  $('#ftot').textContent = files.length ? `Total: ${files.length} File${files.length > 1 ? 's' : ''} · ${fmt(t)}` : '';
  $('#b-create').disabled = !files.length;
}

/* ---------- signaling ---------- */
function signal(code, role, onmsg) {
  return new Promise((res, rej) => {
    if (!me || me.exp <= Date.now()) return rej(new Error('identity'));
    const q = new URLSearchParams({ code, role, name: me.name, id: me.id, exp: me.exp });
    let ws, ok = false;
    try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?${q}`); } catch { return rej(new Error('net')); }
    ws.onmessage = e => { const m = JSON.parse(e.data);
      if (m.type === 'welcome') { ok = true; ws.onclose = () => sess?.lost?.(); res(ws); }
      else if (m.type === 'error') rej(new Error(m.reason)); else onmsg(m); };
    ws.onclose = () => { if (!ok) rej(new Error('net')); };
  });
}
function closeSess() { clearInterval(sess?.ui); try { sess?.close(); } catch {} sess = null; }
const fail = e => { toast(ERR[e.message] || e.message || ERR.net); go('dash'); };

/* ---------- sender ---------- */
$('#b-create').onclick = () => host().catch(fail);
async function host() {
  $('#b-create').disabled = true; toast('Preparing files…', 2000);
  const wm = st.g('fd_wm') !== '0', out = [];
  for (const f of files) out.push(wm && canWatermark(f) ? await watermarkImage(f) : f); // original File objects are never modified
  const meta = out.map((f, i) => ({ name: f.name, size: f.size, type: f.type || 'application/octet-stream', wm: out[i] !== files[i] }));
  const key = await genKey(), kb = await exportKey(key), peers = new Map(); let code, ws, n = 0;
  const onmsg = m => {
    if (m.type === 'peer-joined') add(m.id, m.name);
    else if (m.type === 'peer-left') { const p = peers.get(m.id); if (p) { p.state = 'Disconnected'; p.pc.close(); } }
    else if (m.type === 'signal') peers.get(m.from)?.sig(m.data);
  };
  for (let i = 0; i < 6 && !ws; i++) { code = joinCode(); try { ws = await signal(code, 'host', onmsg); } catch (e) { if (e.message !== 'taken') throw e; } }
  if (!ws) throw new Error('net');
  sess = { role: 'host', close() { ws.close(); peers.forEach(p => p.pc.close()); }, lost() { $('#rstate').textContent = 'Disconnected — room closed'; }, ui: 0 };
  const link = `${location.origin}/#j=${code}&k=${kb}`; // key lives in the URL fragment: never sent to any server
  $('#code').textContent = code; $('#rstate').textContent = 'Waiting for devices...';
  $('#wmnote').textContent = meta.some(m => m.wm) ? 'Images were watermarked in your browser. Other files are sent as original.' : 'No watermark applied (only JPG/PNG/WebP images are supported).';
  $('#b-copy').onclick = () => navigator.clipboard?.writeText(code).then(() => toast('Code copied', 1500), () => toast(code));
  $('#b-share').onclick = () => navigator.share ? navigator.share({ title: 'FluxDrop', text: `Join my FluxDrop room: ${code}`, url: link }).catch(() => {}) : navigator.clipboard?.writeText(link).then(() => toast('Link copied'), () => toast(link));
  $('#b-leave').onclick = () => { closeSess(); go('dash'); $('#b-create').disabled = false; };
  go('room'); $('#b-create').disabled = false;
  const total = out.reduce((a, f) => a + f.size, 0);
  let lastT = performance.now();
  sess.ui = setInterval(() => {
    const now = performance.now(), dt = (now - lastT) / 1000; lastT = now;
    const live = [...peers.values()]; $('#dev').textContent = `Connected Devices: ${live.filter(p => !['Disconnected', 'Failed'].includes(p.state)).length}`;
    $('#peers').innerHTML = live.map(p => {
      p.speed = .7 * p.speed + .3 * ((p.total - p.last) / dt); p.last = p.total;
      const avg = p.t0 ? p.total / ((now - p.t0) / 1000) : 0, eta = p.speed > 1 ? (total - p.total) / p.speed : 0;
      return `<div class="peer"><b>📱 ${esc(p.name)}</b><span>${p.state}${p.err ? ' — ' + esc(p.err) : ''}</span>${bar(total ? p.total / total * 100 : 0)}
      <small>${fmt(p.total)} / ${fmt(total)} · ⚡ ${fmt(p.speed)}/s · avg ${fmt(avg)}/s · ETA ${mmss(eta)}</small>
      ${meta.map((m, i) => `<div class="f">${esc(m.name)} — ${(m.size ? p.sent[i] / m.size * 100 : 100).toFixed(0)}%${bar(m.size ? p.sent[i] / m.size * 100 : 100)}</div>`).join('')}</div>`;
    }).join('');
  }, 250);
  function add(id, name) {
    const pc = new RTCPeerConnection(iceServers()), dc = pc.createDataChannel('f');
    const p = { id, name, pc, dc, state: 'Connecting', sent: meta.map(() => 0), total: 0, salt: n++, last: 0, speed: 0, t0: 0, sending: false };
    dc.binaryType = 'arraybuffer'; peers.set(id, p);
    let q = Promise.resolve();
    p.sig = d => q = q.then(async () => { if (d.sdp) await pc.setRemoteDescription(d.sdp); else if (d.ice) await pc.addIceCandidate(d.ice); }).catch(() => {});
    pc.onicecandidate = e => e.candidate && ws.send(JSON.stringify({ to: id, data: { ice: e.candidate } }));
    pc.onconnectionstatechange = () => { const s = pc.connectionState;
      if (s === 'connected') p.state = p.state === 'Completed' ? 'Completed' : p.sending ? 'Sending' : 'Connected';
      else if (s === 'disconnected') p.state = 'Reconnecting'; else if (s === 'failed') p.state = 'Failed'; else if (s === 'closed' && p.state !== 'Completed') p.state = 'Disconnected'; };
    dc.onmessage = e => { const m = JSON.parse(e.data); if (m.t !== 'ready') return;
      dc.send(JSON.stringify({ t: 'hello', files: meta, k: m.needKey ? kb : undefined }));
      send(p, out, key).catch(err => { p.state = 'Failed'; p.err = err.message === 'closed' ? 'Receiver disconnected' : 'Transfer interrupted'; }); };
    pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => ws.send(JSON.stringify({ to: id, data: { sdp: pc.localDescription } }))).catch(() => p.state = 'Failed');
  }
}
async function send(p, out, key) {
  const dc = p.dc; dc.bufferedAmountLowThreshold = 256 * 1024; p.sending = true; p.state = 'Sending'; p.t0 = performance.now();
  for (let fi = 0; fi < out.length; fi++) {
    const f = out[fi]; dc.send(JSON.stringify({ t: 'start', i: fi }));
    for (let o = 0, c = 0; o < f.size; o += CH, c++) {
      if (dc.readyState !== 'open') throw new Error('closed');
      if (dc.bufferedAmount > HI) await new Promise(r => { dc.addEventListener('bufferedamountlow', r, { once: true }); dc.addEventListener('close', r, { once: true }); });
      if (dc.readyState !== 'open') throw new Error('closed');
      let buf; try { buf = await f.slice(o, o + CH).arrayBuffer(); } catch { throw new Error('File read failure'); }
      dc.send(await encryptChunk(key, p.salt, fi, c, buf));
      p.sent[fi] = o + buf.byteLength; p.total += buf.byteLength;
    }
    dc.send(JSON.stringify({ t: 'end', i: fi }));
  }
  dc.send(JSON.stringify({ t: 'done' })); p.sending = false; p.state = 'Completed';
}

/* ---------- receiver ---------- */
$('#jf').onsubmit = e => { e.preventDefault(); join($('#jc').value.trim()).catch(fail); };
async function join(code) {
  if (!/^\d{6}$/.test(code)) throw new Error('invalid');
  const R = { state: 'Connecting...', meta: [], got: [], links: [], speed: 0, last: 0, tot: 0 };
  $('#cstate').textContent = 'Connecting...'; $('#rfiles').innerHTML = ''; go('conn');
  const hp = new URLSearchParams(location.hash.slice(1)); let key = null;
  if (hp.get('k')) try { key = await importKey(hp.get('k')); } catch {}
  const pc = new RTCPeerConnection(iceServers()); let ws, q = Promise.resolve(), mq = Promise.resolve(), cur = 0, ctr = 0, parts = [], t0 = 0;
  const sig = d => q = q.then(async () => {
    if (d.sdp) { await pc.setRemoteDescription(d.sdp); if (d.sdp.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); ws.send(JSON.stringify({ to: 'host', data: { sdp: pc.localDescription } })); } }
    else if (d.ice) await pc.addIceCandidate(d.ice); }).catch(() => {});
  pc.onicecandidate = e => e.candidate && ws?.send(JSON.stringify({ to: 'host', data: { ice: e.candidate } }));
  pc.onconnectionstatechange = () => { const s = pc.connectionState; if (R.state === 'Completed') return;
    if (s === 'disconnected') R.state = 'Connection Lost — Reconnecting...'; else if (s === 'failed') R.state = 'Failed'; else if (s === 'closed') R.state = 'Disconnected'; else if (s === 'connected' && !R.meta.length) R.state = 'Connected'; };
  pc.ondatachannel = ev => { const dc = ev.channel; dc.binaryType = 'arraybuffer';
    dc.onopen = () => dc.send(JSON.stringify({ t: 'ready', needKey: !key }));
    dc.onclose = () => { if (R.state !== 'Completed') R.state = 'Disconnected — sender left'; };
    dc.onmessage = e => { mq = mq.then(() => handle(e.data)).catch(err => { R.state = 'Failed: ' + (err.name === 'OperationError' ? 'decryption failed (wrong key?)' : 'insufficient memory or data error'); dc.close(); }); }; };
  async function handle(d) {
    if (typeof d === 'string') { const m = JSON.parse(d);
      if (m.t === 'hello') { R.meta = m.files; R.got = m.files.map(() => 0); R.links = m.files.map(() => null); if (!key && m.k) key = await importKey(m.k); R.state = 'Connected'; }
      else if (m.t === 'start') { cur = m.i; ctr = 0; parts = []; t0 = t0 || performance.now(); R.state = 'Receiving'; }
      else if (m.t === 'end') { const f = R.meta[cur], url = URL.createObjectURL(new Blob(parts, { type: f.type })); parts = []; R.links[cur] = url;
        const a = document.createElement('a'); a.href = url; a.download = f.name; document.body.append(a); a.click(); a.remove(); }
      else if (m.t === 'done') R.state = 'Completed';
    } else { const pt = await decryptChunk(key, d, cur, ctr++); parts.push(pt); R.got[cur] += pt.byteLength; R.tot += pt.byteLength; }
  }
  try { ws = await signal(code, 'peer', m => m.type === 'signal' && sig(m.data)); } catch (e) { pc.close(); throw e; }
  sess = { role: 'peer', close() { ws.close(); pc.close(); }, lost() { if (R.state !== 'Completed') R.state = 'Disconnected'; }, ui: 0 };
  let lt = performance.now();
  sess.ui = setInterval(() => { const now = performance.now(), dt = (now - lt) / 1000; lt = now; R.speed = .7 * R.speed + .3 * ((R.tot - R.last) / dt); R.last = R.tot;
    const total = R.meta.reduce((a, f) => a + f.size, 0), avg = t0 ? R.tot / ((now - t0) / 1000) : 0;
    $('#cstate').textContent = R.state === 'Completed' ? 'Download Complete' : R.state;
    $('#rfiles').innerHTML = R.meta.map((f, i) => { const p = f.size ? R.got[i] / f.size * 100 : 100;
      return `<div class="f"><b>${icon(f.type)} ${esc(f.name)}</b>${f.wm ? ' <small>(watermarked)</small>' : ''}${bar(p)}${fmt(R.got[i])} / ${fmt(f.size)} · ${p.toFixed(0)}%${R.links[i] ? ` · <a href="${R.links[i]}" download="${esc(f.name)}">Save again</a>` : ''}</div>`; }).join('')
      + (R.meta.length ? `<small>⚡ ${fmt(R.speed)}/s · avg ${fmt(avg)}/s · ETA ${mmss(R.speed > 1 ? (total - R.tot) / R.speed : 0)}</small>` : ''); }, 250);
  $('#b-rleave').onclick = () => { closeSess(); go('dash'); };
}
boot();
