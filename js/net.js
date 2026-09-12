// PeerJS star topology: the host owns the lobby and relays game state.
// Messages are plain JSON: { t: type, d: data }.

const PREFIX = 'mzrun-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(len = 5) {
  let s = '';
  const a = new Uint32Array(len); crypto.getRandomValues(a);
  for (let i = 0; i < len; i++) s += CODE_CHARS[a[i] % CODE_CHARS.length];
  return s;
}

export class Net {
  constructor() {
    this.peer = null;
    this.isHost = false;
    this.id = null;
    this.code = null;
    this.conns = new Map();   // host: peerId -> DataConnection
    this.hostConn = null;     // client: connection to host
    this.handlers = new Map();
    this.closed = false;
  }

  on(type, fn) { this.handlers.set(type, fn); return this; }
  _emit(type, data, from) { const h = this.handlers.get(type); if (h) h(data, from); }

  _newPeer(id) {
    // Public PeerJS signalling server + Google STUN so peers behind NAT can connect.
    return new Peer(id, {
      debug: 1,
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] },
    });
  }

  /** Create a room; resolves with the room code. */
  host() {
    return new Promise((resolve, reject) => {
      const tryCode = (attempt) => {
        const code = randomCode();
        const peer = this._newPeer(PREFIX + code);
        let settled = false;
        peer.on('open', (id) => {
          settled = true;
          this.peer = peer; this.id = id; this.code = code; this.isHost = true;
          peer.on('connection', (conn) => this._acceptConn(conn));
          peer.on('error', (e) => this._emit('error', e));
          peer.on('disconnected', () => { if (!this.closed) peer.reconnect(); });
          resolve(code);
        });
        peer.on('error', (e) => {
          if (settled) return;
          settled = true;
          peer.destroy();
          if (e.type === 'unavailable-id' && attempt < 5) tryCode(attempt + 1);
          else reject(e);
        });
      };
      tryCode(0);
    });
  }

  _acceptConn(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      this._emit('peer-open', null, conn.peer);
    });
    conn.on('data', (msg) => { if (msg && msg.t) this._emit(msg.t, msg.d, conn.peer); });
    const drop = () => { if (this.conns.delete(conn.peer)) this._emit('peer-close', null, conn.peer); };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  /** Join a room by code. Resolves when the data channel is open. */
  join(code) {
    code = code.trim().toUpperCase();
    return new Promise((resolve, reject) => {
      const peer = this._newPeer(undefined);
      let settled = false;
      const fail = (e) => { if (settled) return; settled = true; peer.destroy(); reject(e); };
      peer.on('open', (id) => {
        this.peer = peer; this.id = id; this.code = code; this.isHost = false;
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        const timer = setTimeout(() => fail(new Error('Could not reach that room. Check the code and try again.')), 12000);
        conn.on('open', () => {
          clearTimeout(timer); settled = true;
          this.hostConn = conn;
          conn.on('data', (msg) => { if (msg && msg.t) this._emit(msg.t, msg.d, conn.peer); });
          conn.on('close', () => this._emit('host-lost'));
          conn.on('error', () => this._emit('host-lost'));
          resolve(id);
        });
        conn.on('error', (e) => { clearTimeout(timer); fail(e); });
        peer.on('error', (e) => {
          if (e.type === 'peer-unavailable') { clearTimeout(timer); fail(new Error('Room not found.')); }
          else if (!settled) { clearTimeout(timer); fail(e); }
          else this._emit('error', e);
        });
      });
      peer.on('error', (e) => fail(e));
    });
  }

  /** Client -> host. */
  send(t, d) { if (this.hostConn && this.hostConn.open) this.hostConn.send({ t, d }); }

  /** Host -> one peer. */
  sendTo(peerId, t, d) { const c = this.conns.get(peerId); if (c && c.open) c.send({ t, d }); }

  /** Host -> everyone (optionally except one). */
  broadcast(t, d, except = null) {
    const msg = { t, d };
    for (const [id, c] of this.conns) if (id !== except && c.open) c.send(msg);
  }

  kick(peerId) { const c = this.conns.get(peerId); if (c) c.close(); this.conns.delete(peerId); }

  close() {
    this.closed = true;
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
    if (this.hostConn) this.hostConn.close();
    this.hostConn = null;
    if (this.peer) this.peer.destroy();
    this.peer = null;
  }
}
