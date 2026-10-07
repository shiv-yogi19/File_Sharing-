// One Durable Object per join code: relays signaling (SDP/ICE) text messages only.
const TTL = 2 * 60 * 60 * 1000; // room lifetime
const MAX_MSG = 16 * 1024;      // signaling only; rejects anything file-sized

export class Room {
  constructor(state) { this.s = state; }

  async fetch(req) {
    const u = new URL(req.url);
    const role = u.searchParams.get('role');
    const name = (u.searchParams.get('name') || 'Device').slice(0, 24);
    const [client, server] = Object.values(new WebSocketPair());
    const host = this.s.getWebSockets('host')[0];
    const expired = await this.s.storage.get('exp');
    let err = null;
    if (role === 'host' && host) err = 'taken';
    if (role === 'peer' && !host) err = expired ? 'expired' : 'invalid';
    if (err) {
      server.accept(); server.send(JSON.stringify({ type: 'error', reason: err })); server.close(1000, err);
      return new Response(null, { status: 101, webSocket: client });
    }
    const id = crypto.randomUUID().slice(0, 8);
    this.s.acceptWebSocket(server, [role, id]);
    server.serializeAttachment({ id, role, name });
    if (role === 'host') {
      await this.s.storage.put('exp', Date.now() + TTL);
      await this.s.storage.setAlarm(Date.now() + TTL);
    } else host.send(JSON.stringify({ type: 'peer-joined', id, name }));
    server.send(JSON.stringify({ type: 'welcome', id }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > MAX_MSG) return ws.close(1009, 'signaling only');
    let m; try { m = JSON.parse(msg); } catch { return; }
    const me = ws.deserializeAttachment();
    const target = me.role === 'host' ? this.s.getWebSockets(String(m.to))[0] : this.s.getWebSockets('host')[0];
    if (target && target !== ws) target.send(JSON.stringify({ type: 'signal', from: me.id, data: m.data }));
  }

  async webSocketClose(ws) {
    const me = ws.deserializeAttachment();
    if (me?.role === 'host') {
      this.s.getWebSockets().forEach(s => { try { s.close(1000, 'host left'); } catch {} });
      await this.s.storage.deleteAll();
    } else this.s.getWebSockets('host')[0]?.send(JSON.stringify({ type: 'peer-left', id: me?.id }));
  }
  webSocketError(ws) { return this.webSocketClose(ws); }

  async alarm() { // room expiry: drop everyone, clear temporary state (keeps nothing)
    this.s.getWebSockets().forEach(s => { try { s.close(1000, 'expired'); } catch {} });
    await this.s.storage.deleteAll();
  }
}
