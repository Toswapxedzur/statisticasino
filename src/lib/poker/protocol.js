// Isomorphic WebSocket message protocol for the poker room.
//
// Safe to import from BOTH the browser client and the Node server — it
// contains only string constants and small helpers, no I/O. Keeping the
// message-type names in one place stops the client and server drifting.
//
// Wire format: every frame is JSON `{ t: <type>, ...fields }`. `t` is one
// of the constants below.

// Client -> Server
export const C2S = {
  HELLO: "hello",              // {}
  LOBBY_SUB: "lobby.sub",      // subscribe to live lobby updates
  LOBBY_UNSUB: "lobby.unsub",
  // PlayOK-style lobby (v11)
  TABLE_CREATE: "table.create", // poker: { name?, variant?, smallBlind, bigBlind, maxSeats, minBuyin, maxBuyin, buyin }
                                // blackjack: { name?, variant:"blackjack", beBanker?, smallBlind(=minBet), maxSeats, minBuyin, maxBuyin, buyin }
  QUICK_PLAY: "quickplay",      // { buyin? } — instant auto-seat
  LOBBY_CHAT: "lobby.chat",     // { text }
  INVITE: "invite",             // { toUserId } — invite to my current table
  INVITE_RESPOND: "invite.respond", // { inviteId, accept }
  TABLE_JOIN: "table.join",    // { tableId }  — start watching a table
  TABLE_LEAVE: "table.leave",  // { tableId }  — stop watching
  TABLE_SIT: "table.sit",      // { tableId, seat, buyin }
  TABLE_STAND: "table.stand",  // { tableId }  — leave your seat, cash out
  TABLE_ACTION: "table.action",// { tableId, action: {type, amount?} }
  TABLE_REBUY: "table.rebuy",  // { tableId, amount }
  TABLE_SITOUT: "table.sitout",// { tableId, sitOut: bool }
  TABLE_ADD_BOT: "table.addbot",     // { tableId, tier?, seat? } — seat a bot
  TABLE_REMOVE_BOT: "table.removebot", // { tableId, seat } — remove the bot at seat
  CHAT: "chat",                // { tableId, text }
  WAITLIST_JOIN: "waitlist.join",   // { tableId, buyin } — queue for a full table
  WAITLIST_LEAVE: "waitlist.leave", // { tableId }
  DM_SEND: "dm.send",          // { toUserId, text } — private message to a friend
  DM_READ: "dm.read",          // { withUserId } — mark a conversation read
  VOICE_JOIN: "voice.join",    // { tableId } — join a table's voice mesh
  VOICE_LEAVE: "voice.leave",  // { tableId }
  RTC_SIGNAL: "rtc.signal",    // { tableId, toUserId, signal } — WebRTC offer/answer/ice relay
  PONG: "pong"
};

// Server -> Client
export const S2C = {
  HELLO_OK: "hello.ok",        // { user: {id, name, isAdmin}, chips }
  LOBBY: "lobby",              // { tables:[LobbyTable], players:[LobbyPlayer], leaderboard:[{name,chips}] }
  LOBBY_CHAT: "lobby.chat",    // { from, text, ts }
  TABLE_CREATED: "table.created", // { tableId } — navigate here (create / quickplay / invite-accept)
  INVITE: "invite",            // { inviteId, fromName, fromUserId, tableId, tableName } — incoming
  TABLE_STATE: "table.state",  // { tableId, table: <public view> }
  TABLE_PRIVATE: "table.private", // { tableId, seat, holeCards }
  TABLE_TURN: "table.turn",    // { tableId, seat, deadline, callAmount, currentBet, minRaise, potTotal, actions:[...] } — only to the acting user
  TABLE_LEFT: "table.left",    // { tableId }
  CHIPS: "chips",              // { chips }  — wallet balance changed
  CHAT: "chat",                // { tableId, from, text, ts }
  TOAST: "toast",              // { level, text }
  DM: "dm",                    // { id, fromUserId, fromName, toUserId, text, ts } — a private message (echoed to both parties)
  VOICE_ROSTER: "voice.roster",// { tableId, users:[{userId,name}] } — who's in the table's voice mesh
  ICE_CONFIG: "voice.ice",     // { iceServers } — STUN/TURN config for RTCPeerConnection (ephemeral creds)
  RTC_SIGNAL: "rtc.signal",    // { tableId, fromUserId, signal } — relayed WebRTC signal
  ERROR: "error",             // { code?, msg }
  PING: "ping"
};

export function encode(type, fields = {}) {
  return JSON.stringify({ t: type, ...fields });
}

export function decode(raw) {
  try {
    const msg = JSON.parse(raw);
    if (msg && typeof msg.t === "string") return msg;
  } catch {
    /* fall through */
  }
  return null;
}
