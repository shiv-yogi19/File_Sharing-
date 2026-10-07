// Signaling only. File bytes never pass through here.
export { Room } from './room.js';

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname !== '/ws') return env.ASSETS.fetch(req);
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const code = u.searchParams.get('code') || '';
    const id = u.searchParams.get('id') || '';
    const exp = Number(u.searchParams.get('exp'));
    const role = u.searchParams.get('role');
    if (!/^\d{6}$/.test(code) || !/^FD-[0-9A-F]{4}-[0-9A-F]{4}$/.test(id) || !['host', 'peer'].includes(role))
      return new Response('Bad request', { status: 400 });
    if (!(exp > Date.now())) return new Response('Identity expired', { status: 403 });
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
  }
};
