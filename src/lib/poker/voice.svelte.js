// Browser-side table voice: a WebRTC audio MESH among the people in a table's
// voice room. Signaling (SDP offer/answer + ICE candidates) is relayed through the
// existing poker WebSocket (see hub.relaySignal); media flows peer-to-peer (or via
// our coturn TURN relay for peers that can't connect directly).
//
// Glare-free negotiation: for any pair, the peer with the LEXICOGRAPHICALLY SMALLER
// userId is the offerer; the other waits for the offer. Both create their
// RTCPeerConnection when they first see each other in the roster.

import { browser } from "$app/environment";
import { poker } from "./client.svelte.js";
import { play } from "$lib/sfx.js";
import { tuneOpusSdp, RECOVERY_WAIT_MS, MAX_RECOVERY_ATTEMPTS, DISCONNECT_GRACE_MS } from "./voice-tune.js";

const FALLBACK_ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// Map the browser's getUserMedia failure to something a player can act on.
export function micErrorText(e) {
  switch (e?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Microphone blocked. Allow it for this site in your browser settings (the lock icon by the address bar).";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone found on this device.";
    case "NotReadableError":
    case "TrackStartError":
      return "Microphone is in use by another app or blocked by the system.";
    case "SecurityError":
      return "This browser won't allow the microphone here. Open the site in Safari or Chrome.";
    default:
      return "Microphone access failed" + (e?.name ? " (" + e.name + ")" : "") + ".";
  }
}

class Voice {
  active = $state(false);
  muted = $state(false);
  error = $state(null);
  // userId -> { name, state } for the remote peers (drives the participant list).
  peers = $state({});

  _tableId = null;
  _localStream = null;
  _pcs = new Map();       // userId -> RTCPeerConnection
  _meta = new Map();      // userId -> { name, offerer, attempts, timer, pending: [ice] }
  _audioEls = new Map();  // userId -> HTMLAudioElement
  _ice = FALLBACK_ICE;
  _myId = null;

  constructor() {
    if (browser) {
      poker.setVoiceHandlers({
        roster: (m) => this._onRoster(m),
        ice: (m) => this._onIce(m),
        signal: (m) => this._onSignal(m)
      });
    }
  }

  async join(tableId) {
    if (!browser || this.active) return;
    this._myId = poker.me?.id;
    if (!this._myId) { this.error = "Sign in to use voice."; return; }
    if (!navigator.mediaDevices?.getUserMedia) {
      // In-app browsers (WeChat, QQ, links opened inside another app) and http pages have no mic API.
      this.error = window.isSecureContext
        ? "This browser can't use the microphone. Open the site in Safari or Chrome."
        : "Voice needs a secure (https) page.";
      return;
    }
    try {
      this._localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch (e) {
      this.error = micErrorText(e);
      return;
    }
    this.error = null;
    this._tableId = tableId;
    this.active = true;
    this.muted = false;
    poker.voiceJoin(tableId); // server replies with ICE config, then the roster
  }

  leave() {
    if (!this.active) return;
    if (this._tableId) poker.voiceLeave(this._tableId);
    for (const id of [...this._pcs.keys()]) this._closePeer(id);
    for (const m of this._meta.values()) clearTimeout(m.timer);
    this._meta.clear();
    if (this._localStream) { for (const t of this._localStream.getTracks()) t.stop(); this._localStream = null; }
    this.active = false;
    this.muted = false;
    this.peers = {};
    this._tableId = null;
  }

  toggleMute() {
    if (!this._localStream) return;
    this.muted = !this.muted;
    for (const t of this._localStream.getAudioTracks()) t.enabled = !this.muted;
  }

  // ---- server-driven events ----

  _onIce(msg) { if (msg?.iceServers) this._ice = { iceServers: msg.iceServers }; }

  _onRoster(msg) {
    if (!this.active || msg.tableId !== this._tableId) return;
    const others = (msg.users || []).map((u) => u.userId).filter((id) => id !== this._myId);
    const nameById = new Map((msg.users || []).map((u) => [u.userId, u.name]));
    // New peers: create a connection (the smaller-id side offers).
    for (const id of others) {
      if (!this._meta.has(id)) { play("voiceIn"); this._connectTo(id, nameById.get(id), this._myId < id); }
    }
    // Departed peers: tear down.
    for (const id of [...this._meta.keys()]) if (!others.includes(id)) { play("voiceOut"); this._closePeer(id); }
  }

  async _onSignal(msg) {
    if (!this.active || msg.tableId !== this._tableId) return;
    const from = msg.fromUserId;
    const signal = msg.signal || {};
    let pc = this._pcs.get(from);
    // The offerer rebuilt its connection from scratch: drop ours and answer on a fresh one.
    if (pc && (signal.reset || pc.signalingState === "closed")) { this._closePeer(from, { forget: false }); pc = null; }
    if (!pc) pc = this._connectTo(from, this.peers[from]?.name || this._meta.get(from)?.name || "Player", false); // they offered first
    const meta = this._meta.get(from);
    try {
      if (signal.sdp) {
        await pc.setRemoteDescription(signal.sdp);
        // Candidates that arrived before the description can be applied now.
        const queued = meta?.pending || [];
        if (meta) meta.pending = [];
        for (const c of queued) { try { await pc.addIceCandidate(c); } catch { /* stale */ } }
        if (signal.sdp.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription({ type: answer.type, sdp: tuneOpusSdp(answer.sdp) });
          poker.sendSignal(this._tableId, from, { sdp: pc.localDescription });
        }
      } else if (signal.ice) {
        if (!pc.remoteDescription) { meta?.pending.push(signal.ice); return; }
        try { await pc.addIceCandidate(signal.ice); } catch { /* candidate for an older negotiation; ignore */ }
      }
    } catch (e) {
      // Typically an answer that no longer fits our connection (the peer rebuilt theirs). If we own
      // the pair, skip straight to a rebuild instead of letting the recovery timer run out.
      console.warn("[voice] signal failed:", e?.message || e);
      if (meta?.offerer && this._pcs.get(from) === pc) {
        meta.attempts = Math.max(meta.attempts, 1);
        clearTimeout(meta.timer); meta.timer = null;
        this._recover(from);
      } else this.error = "Voice connection error.";
    }
  }

  // ---- peer plumbing ----

  _connectTo(peerId, name, isOfferer, { relay = false, reset = false } = {}) {
    const cfg = { ...this._ice };
    if (relay && this._hasTurn()) cfg.iceTransportPolicy = "relay";
    const pc = new RTCPeerConnection(cfg);
    this._pcs.set(peerId, pc);
    let meta = this._meta.get(peerId);
    if (!meta) { meta = { name: name || "Player", offerer: isOfferer, attempts: 0, timer: null, pending: [] }; this._meta.set(peerId, meta); }
    meta.pending = [];
    this.peers = { ...this.peers, [peerId]: { name: meta.name, state: reset ? "reconnecting" : "connecting" } };

    for (const track of this._localStream.getTracks()) pc.addTrack(track, this._localStream);

    pc.onicecandidate = (e) => { if (e.candidate) poker.sendSignal(this._tableId, peerId, { ice: e.candidate }); };
    pc.ontrack = (e) => this._attachAudio(peerId, e.streams[0]);
    pc.onconnectionstatechange = () => {
      if (this._pcs.get(peerId) !== pc) return; // a replaced connection; ignore its death throes
      const st = pc.connectionState;
      if (st === "connected") {
        meta.attempts = 0; clearTimeout(meta.timer); meta.timer = null;
        this._setState(peerId, "connected");
      } else if (st === "disconnected") {
        this._setState(peerId, "reconnecting");
        if (!meta.timer) meta.timer = setTimeout(() => { meta.timer = null; if (pc.connectionState !== "connected") this._recover(peerId); }, DISCONNECT_GRACE_MS);
      } else if (st === "failed" || st === "closed") {
        // "closed" here means the transport died under us (we null this handler before closing on purpose).
        this._setState(peerId, "reconnecting");
        clearTimeout(meta.timer); meta.timer = null;
        this._recover(peerId);
      } else if (st === "connecting" || st === "new") {
        if (this.peers[peerId]?.state !== "reconnecting") this._setState(peerId, "connecting");
      }
    };

    if (isOfferer) {
      pc.createOffer()
        .then((o) => pc.setLocalDescription({ type: o.type, sdp: tuneOpusSdp(o.sdp) }))
        .then(() => poker.sendSignal(this._tableId, peerId, { sdp: pc.localDescription, reset }))
        .catch(() => { this.error = "Couldn't start the call."; });
    }
    return pc;
  }

  _hasTurn() { return (this._ice?.iceServers || []).some((s) => [].concat(s.urls || []).some((u) => /^turns?:/i.test(String(u)))); }

  _setState(peerId, state) {
    if (this.peers[peerId] && this.peers[peerId].state !== state) this.peers = { ...this.peers, [peerId]: { ...this.peers[peerId], state } };
  }

  // A peer connection dropped. The offerer drives recovery: first an ICE restart on
  // the same connection, then a rebuild forced through the TURN relay, then plain
  // rebuilds with backoff. The answerer just waits for the offerer's new offer and
  // clears its dead connection if none comes, so the next offer lands on a fresh one.
  async _recover(peerId) {
    const meta = this._meta.get(peerId);
    const pc = this._pcs.get(peerId);
    if (!this.active || !meta || (pc && pc.connectionState === "connected")) return;
    if (!pc && meta.offerer) return; // the offerer always owns a connection; nothing to restart
    if (meta.attempts >= MAX_RECOVERY_ATTEMPTS) { this._setState(peerId, "failed"); return; }
    const attempt = meta.attempts++;
    const wait = RECOVERY_WAIT_MS[attempt];
    this._setState(peerId, "reconnecting");
    if (!meta.offerer) {
      // A dead transport can't take the offerer's ICE-restart offer: drop it now so the offer lands on a
      // fresh connection. A mere "disconnected" keeps the connection, since a restart may still heal it.
      if (pc.connectionState === "failed" || pc.connectionState === "closed") this._closePeer(peerId, { forget: false });
      // Give the offerer a while; if it never re-offers, drop whatever is left so a later offer starts clean.
      clearTimeout(meta.timer);
      meta.timer = setTimeout(() => { meta.timer = null; const cur = this._pcs.get(peerId); if (!cur || cur.connectionState !== "connected") { if (cur) this._closePeer(peerId, { forget: false }); this._recover(peerId); } }, wait);
      return;
    }
    try {
      if (attempt === 0 && pc.signalingState !== "closed") {
        const o = await pc.createOffer({ iceRestart: true });
        if (this._pcs.get(peerId) !== pc) return;
        await pc.setLocalDescription({ type: o.type, sdp: tuneOpusSdp(o.sdp) });
        poker.sendSignal(this._tableId, peerId, { sdp: pc.localDescription });
      } else {
        this._closePeer(peerId, { forget: false });
        this._connectTo(peerId, meta.name, true, { relay: attempt === 1, reset: true });
      }
    } catch { /* fall through to the timer, which escalates */ }
    clearTimeout(meta.timer);
    meta.timer = setTimeout(() => { meta.timer = null; const cur = this._pcs.get(peerId); if (cur && cur.connectionState !== "connected") this._recover(peerId); }, wait);
  }

  _attachAudio(peerId, stream) {
    let el = this._audioEls.get(peerId);
    if (!el) {
      el = document.createElement("audio");
      el.autoplay = true;
      el.dataset.voicePeer = peerId;
      document.body.appendChild(el);
      this._audioEls.set(peerId, el);
    }
    el.srcObject = stream;
  }

  _closePeer(peerId, { forget = true } = {}) {
    const pc = this._pcs.get(peerId);
    if (pc) { pc.onconnectionstatechange = null; pc.onicecandidate = null; pc.ontrack = null; try { pc.close(); } catch { /* already closed */ } this._pcs.delete(peerId); }
    const el = this._audioEls.get(peerId);
    if (el) { el.srcObject = null; el.remove(); this._audioEls.delete(peerId); }
    if (!forget) return; // keep the roster entry + recovery bookkeeping: a fresh connection is coming
    const meta = this._meta.get(peerId);
    if (meta) { clearTimeout(meta.timer); this._meta.delete(peerId); }
    if (this.peers[peerId]) { const p = { ...this.peers }; delete p[peerId]; this.peers = p; }
  }
}

export const voice = new Voice();
if (browser) window.__voice = voice; // hook for the E2E harness (nothing here a devtools user couldn't reach anyway)
