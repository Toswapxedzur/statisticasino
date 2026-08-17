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
  toast = $state(null);         // { level, text } transient
  lastError = $state(null);

  _wantLobby = false;
  _watching = new Set();
  _backoff = 500;
  _reconnectTimer = null;

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
      case S2C.TOAST:
        this.toast = { level: msg.level, text: msg.text };
        break;
      case S2C.ERROR:
        this.lastError = msg.msg;
        this.toast = { level: "error", text: msg.msg };
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

  // -------------------------------------------------- table

  joinTable(tableId) { this._watching.add(tableId); this.connect(); this._raw(encode(C2S.TABLE_JOIN, { tableId })); }
  leaveTable(tableId) { this._watching.delete(tableId); this._raw(encode(C2S.TABLE_LEAVE, { tableId })); }

  sit(tableId, seat, buyin) { this._raw(encode(C2S.TABLE_SIT, { tableId, seat, buyin })); }
  stand(tableId) { this._raw(encode(C2S.TABLE_STAND, { tableId })); }
  act(tableId, action) { this._raw(encode(C2S.TABLE_ACTION, { tableId, action })); }
  rebuy(tableId, amount) { this._raw(encode(C2S.TABLE_REBUY, { tableId, amount })); }
  sitOut(tableId, sitOut) { this._raw(encode(C2S.TABLE_SITOUT, { tableId, sitOut })); }
  sendChat(tableId, text) { this._raw(encode(C2S.CHAT, { tableId, text })); }
}

export const poker = new PokerClient();
