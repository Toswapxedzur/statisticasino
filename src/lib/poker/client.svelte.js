// Browser-side poker WebSocket client — a single reactive instance shared
// across the lobby and table pages (Svelte 5 runes in a .svelte.js
// module). Handles connect, auto-reconnect with backoff, HELLO, and
// re-subscription of whatever the UI was watching.
//
// Import the singleton `poker` and read its `$state` fields directly in
// components; call the action methods to send.

import { browser } from "$app/environment";
import { C2S, S2C, encode, decode } from "./protocol.js";

class PokerClient {
  ws = null;
  connected = $state(false);
  me = $state(null);            // {id, name, isAdmin} | null
  // PlayOK-style lobby snapshot (tables/players/leaderboard).
  lobby = $state({ tables: [], players: [], leaderboard: [] });
  lobbyChat = $state([]);       // [{from,text,ts}] shared lobby chat
  invites = $state([]);         // [{inviteId, fromName, fromUserId, tableId, tableName}] incoming
  pendingNav = $state(null);    // tableId to navigate to (create/quickplay/invite-accept)
  tables = $state({});          // tableId -> public view
  privates = $state({});        // tableId -> { seat, holeCards }
  turns = $state({});           // tableId -> legal-action menu when it's MY turn
  chat = $state({});            // tableId -> [{from,text,ts}]
  dms = $state({});             // otherUserId -> [{id, fromUserId, fromName, text, ts, mine}]
  dmUnread = $state({});        // otherUserId -> count of unseen incoming messages
  toast = $state(null);         // { level, text } transient
  lastError = $state(null);
  // The conversation currently open in the UI (so incoming DMs there don't badge).
  _activeDm = null;

  _wantLobby = false;
  _watching = new Set();
  _backoff = 500;
  _reconnectTimer = null;
  // Pending money ops keyed by "sit:<tid>" / "rebuy:<tid>". Each holds a stable
  // request-boundary opId reused across resends (double-click, reconnect) so the
  // server dedupes them; cleared once the op resolves.
  _pendingMoney = {};

  connect() {
    if (!browser || this.ws) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/ws`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this._backoff = 500;
      this._raw(encode(C2S.HELLO));
      if (this._wantLobby) this._raw(encode(C2S.LOBBY_SUB));
      for (const id of this._watching) this._raw(encode(C2S.TABLE_JOIN, { tableId: id }));
      // Re-send any unresolved money op with its ORIGINAL opId — the server
      // resolves a duplicate rather than double-charging, so this is safe.
      for (const { c2s, msg } of Object.values(this._pendingMoney)) this._raw(encode(c2s, msg));
    };

    ws.onmessage = (ev) => this._onMessage(ev.data);

    ws.onclose = () => {
      this.connected = false;
      this.ws = null;
      this._scheduleReconnect();
    };
    ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
  }

  _scheduleReconnect() {
    if (!browser || this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, this._backoff);
    this._backoff = Math.min(this._backoff * 2, 8000);
  }

  _raw(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  _onMessage(raw) {
    const msg = decode(raw);
    if (!msg) return;
    switch (msg.t) {
      case S2C.HELLO_OK:
        this.me = msg.user;
        break;
      case S2C.LOBBY:
        this.lobby = {
          tables: msg.tables || [],
          players: msg.players || [],
          leaderboard: msg.leaderboard || []
        };
        break;
      case S2C.LOBBY_CHAT:
        this.lobbyChat = [...this.lobbyChat, { from: msg.from, text: msg.text, ts: msg.ts }].slice(-100);
        break;
      case S2C.TABLE_CREATED:
        this.pendingNav = msg.tableId;
        break;
      case S2C.INVITE:
        this.invites = [
          ...this.invites.filter((i) => i.inviteId !== msg.inviteId),
          { inviteId: msg.inviteId, fromName: msg.fromName, fromUserId: msg.fromUserId, tableId: msg.tableId, tableName: msg.tableName }
        ];
        break;
      case S2C.TABLE_STATE: {
        this.tables = { ...this.tables, [msg.tableId]: msg.table };
        // Clear a stale turn menu if it's no longer my turn.
        const mine = this.me && (msg.table?.seats || []).find((s) => s.userId === this.me.id);
        if (this.turns[msg.tableId] && !(mine && mine.isToAct)) {
          const tn = { ...this.turns }; delete tn[msg.tableId]; this.turns = tn;
        }
        // Money ops resolved: I'm seated ⇒ my sit landed; any state update for a
        // table reflects a rebuy I sent. Stop tracking them for resend.
        if (mine) delete this._pendingMoney[`sit:${msg.tableId}`];
        delete this._pendingMoney[`rebuy:${msg.tableId}`];
        break;
      }
      case S2C.TABLE_PRIVATE:
        this.privates = { ...this.privates, [msg.tableId]: { seat: msg.seat, holeCards: msg.holeCards } };
        break;
      case S2C.TABLE_TURN: {
        const { tableId, ...menu } = msg;
        this.turns = { ...this.turns, [tableId]: menu };
        break;
      }
      case S2C.TABLE_LEFT: {
        const t = { ...this.tables }; delete t[msg.tableId];
        const p = { ...this.privates }; delete p[msg.tableId];
        const tn = { ...this.turns }; delete tn[msg.tableId];
        this.tables = t; this.privates = p; this.turns = tn;
        delete this._pendingMoney[`sit:${msg.tableId}`];
        delete this._pendingMoney[`rebuy:${msg.tableId}`];
        break;
      }
      case S2C.CHIPS:
        // Wallet changed server-side; the topbar reads from server load
        // on navigation, but broadcast a custom event for live updates.
        if (browser) window.dispatchEvent(new CustomEvent("chips", { detail: msg.chips }));
        break;
      case S2C.CHAT: {
        const list = this.chat[msg.tableId] || [];
        this.chat = { ...this.chat, [msg.tableId]: [...list, { from: msg.from, text: msg.text, ts: msg.ts }].slice(-100) };
        break;
      }
      case S2C.DM: {
        // Echoed to both parties — the "other" end is whichever id isn't me.
        const mine = this.me && msg.fromUserId === this.me.id;
        const other = mine ? msg.toUserId : msg.fromUserId;
        const list = this.dms[other] || [];
        this.dms = { ...this.dms, [other]: [...list, {
          id: msg.id, fromUserId: msg.fromUserId, fromName: msg.fromName, text: msg.text, ts: msg.ts, mine
        }].slice(-200) };
        // Badge the sender unless I sent it or I'm actively viewing that thread.
        if (!mine && this._activeDm !== other) {
          this.dmUnread = { ...this.dmUnread, [other]: (this.dmUnread[other] || 0) + 1 };
        }
        break;
      }
      case S2C.VOICE_ROSTER:
        this._voice?.roster?.(msg);
        break;
      case S2C.ICE_CONFIG:
        this._voice?.ice?.(msg);
        break;
      case S2C.RTC_SIGNAL:
        this._voice?.signal?.(msg);
        break;
      case S2C.TOAST:
        this.toast = { level: msg.level, text: msg.text };
        break;
      case S2C.ERROR:
        this.lastError = msg.msg;
        this.toast = { level: "error", text: msg.msg };
        // A rejected money op won't produce a seating/state confirmation; drop
        // pending ops so we don't resend a definitively-failed action. A fresh
        // user attempt gets a new opId (a new intent).
        this._pendingMoney = {};
        break;
      case S2C.PING:
        this._raw(encode(C2S.PONG));
        break;
    }
  }

  // -------------------------------------------------- lobby

  subLobby() { this._wantLobby = true; this.connect(); this._raw(encode(C2S.LOBBY_SUB)); }
  unsubLobby() { this._wantLobby = false; this._raw(encode(C2S.LOBBY_UNSUB)); }

  createTable(cfg) { this.connect(); this._raw(encode(C2S.TABLE_CREATE, cfg)); }
  quickPlay(buyin) { this.connect(); this._raw(encode(C2S.QUICK_PLAY, buyin != null ? { buyin } : {})); }
  sendLobbyChat(text) { this._raw(encode(C2S.LOBBY_CHAT, { text })); }
  invitePlayer(toUserId) { this._raw(encode(C2S.INVITE, { toUserId })); }
  respondInvite(inviteId, accept) {
    this.invites = this.invites.filter((i) => i.inviteId !== inviteId);
    this._raw(encode(C2S.INVITE_RESPOND, { inviteId, accept: !!accept }));
  }
  clearNav() { this.pendingNav = null; }

  // -------------------------------------------------- direct messages

  sendDM(toUserId, text) {
    const t = String(text || "").trim();
    if (!t) return;
    this.connect();
    this._raw(encode(C2S.DM_SEND, { toUserId, text: t }));
  }
  // Seed a thread's history (from the page's HTTP load) into the store.
  seedDm(otherUserId, messages) {
    const mapped = (messages || []).map((m) => ({ ...m, mine: this.me && m.fromUserId === this.me.id }));
    this.dms = { ...this.dms, [otherUserId]: mapped };
  }
  // Mark a conversation open (its incoming messages stop badging) and read.
  openDm(otherUserId) {
    this._activeDm = otherUserId;
    if (this.dmUnread[otherUserId]) { const u = { ...this.dmUnread }; delete u[otherUserId]; this.dmUnread = u; }
    this.connect();
    this._raw(encode(C2S.DM_READ, { withUserId: otherUserId }));
  }
  closeDm() { this._activeDm = null; }
  get dmUnreadTotal() { return Object.values(this.dmUnread).reduce((a, b) => a + b, 0); }

  // -------------------------------------------------- table

  joinTable(tableId) { this._watching.add(tableId); this.connect(); this._raw(encode(C2S.TABLE_JOIN, { tableId })); }
  leaveTable(tableId) {
    this._watching.delete(tableId);
    delete this._pendingMoney[`sit:${tableId}`];
    delete this._pendingMoney[`rebuy:${tableId}`];
    this._raw(encode(C2S.TABLE_LEAVE, { tableId }));
  }
  joinWaitlist(tableId, buyin) { this.connect(); this._raw(encode(C2S.WAITLIST_JOIN, { tableId, ...(buyin != null ? { buyin } : {}) })); }
  leaveWaitlist(tableId) { this._raw(encode(C2S.WAITLIST_LEAVE, { tableId })); }

  // -------------------------------------------------- voice (WebRTC signaling)

  setVoiceHandlers(h) { this._voice = h; }
  voiceJoin(tableId) { this.connect(); this._raw(encode(C2S.VOICE_JOIN, { tableId })); }
  voiceLeave(tableId) { this._raw(encode(C2S.VOICE_LEAVE, { tableId })); }
  sendSignal(tableId, toUserId, signal) { this._raw(encode(C2S.RTC_SIGNAL, { tableId, toUserId, signal })); }

  // Every table I'm currently SEATED at (I keep watching them across navigation),
  // with a flag for whether it's my turn there — powers the multi-table switcher.
  get myTables() {
    if (!this.me) return [];
    const out = [];
    for (const [tableId, t] of Object.entries(this.tables)) {
      const seat = (t?.seats || []).find((s) => s.userId === this.me.id);
      if (seat) out.push({ tableId, name: t?.config?.name || "Table", myTurn: !!seat.isToAct });
    }
    return out;
  }

  _opId() {
    if (browser && globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  // Send a money op with a stable request-boundary opId. Rapid re-fires (double-
  // click) before it resolves reuse the same opId, and it's re-sent verbatim on
  // reconnect — the server dedupes by the key, so it can't double-charge.
  _sendMoney(key, c2s, base) {
    const existing = this._pendingMoney[key];
    const opId = existing ? existing.msg.opId : this._opId();
    const msg = { ...base, opId };
    this._pendingMoney[key] = { c2s, msg };
    this._raw(encode(c2s, msg));
  }

  sit(tableId, seat, buyin) { this.connect(); this._sendMoney(`sit:${tableId}`, C2S.TABLE_SIT, { tableId, seat, buyin }); }
  stand(tableId) {
    delete this._pendingMoney[`sit:${tableId}`];
    delete this._pendingMoney[`rebuy:${tableId}`];
    this._raw(encode(C2S.TABLE_STAND, { tableId }));
  }
  act(tableId, action) { this._raw(encode(C2S.TABLE_ACTION, { tableId, action })); }
  rebuy(tableId, amount) { this._sendMoney(`rebuy:${tableId}`, C2S.TABLE_REBUY, { tableId, amount }); }
  sitOut(tableId, sitOut) { this._raw(encode(C2S.TABLE_SITOUT, { tableId, sitOut })); }
  addBot(tableId, tier, seat) { this.connect(); this._raw(encode(C2S.TABLE_ADD_BOT, { tableId, ...(tier ? { tier } : {}), ...(seat != null ? { seat } : {}) })); }
  removeBot(tableId, seat) { this._raw(encode(C2S.TABLE_REMOVE_BOT, { tableId, seat })); }
  sendChat(tableId, text) { this._raw(encode(C2S.CHAT, { tableId, text })); }
}

export const poker = new PokerClient();
