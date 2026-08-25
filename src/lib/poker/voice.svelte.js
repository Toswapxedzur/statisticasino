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

const FALLBACK_ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

class Voice {
  active = $state(false);
  muted = $state(false);
  error = $state(null);
  // userId -> { name, state } for the remote peers (drives the participant list).
  peers = $state({});

  _tableId = null;
  _localStream = null;
  _pcs = new Map();       // userId -> RTCPeerConnection
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
    try {
      this._localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      this.error = "Microphone access was blocked.";
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
      if (!this._pcs.has(id)) this._connectTo(id, nameById.get(id), this._myId < id);
    }
    // Departed peers: tear down.
    for (const id of [...this._pcs.keys()]) if (!others.includes(id)) this._closePeer(id);
  }

  async _onSignal(msg) {
    if (!this.active || msg.tableId !== this._tableId) return;
    const from = msg.fromUserId;
    let pc = this._pcs.get(from);
    if (!pc) pc = this._connectTo(from, this.peers[from]?.name || "Player", false); // they offered first
    const signal = msg.signal || {};
    try {
      if (signal.sdp) {
        await pc.setRemoteDescription(signal.sdp);
        if (signal.sdp.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          poker.sendSignal(this._tableId, from, { sdp: pc.localDescription });
        }
      } else if (signal.ice) {
        try { await pc.addIceCandidate(signal.ice); } catch { /* candidate arrived before remote desc; ignore */ }
      }
    } catch (e) { this.error = "Voice connection error."; void e; }
  }

  // ---- peer plumbing ----

  _connectTo(peerId, name, isOfferer) {
    const pc = new RTCPeerConnection(this._ice);
    this._pcs.set(peerId, pc);
    this.peers = { ...this.peers, [peerId]: { name: name || "Player", state: "connecting" } };

    for (const track of this._localStream.getTracks()) pc.addTrack(track, this._localStream);

    pc.onicecandidate = (e) => { if (e.candidate) poker.sendSignal(this._tableId, peerId, { ice: e.candidate }); };
    pc.ontrack = (e) => this._attachAudio(peerId, e.streams[0]);
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (this.peers[peerId]) this.peers = { ...this.peers, [peerId]: { ...this.peers[peerId], state: st } };
      if (st === "failed" || st === "closed") this._closePeer(peerId);
    };

    if (isOfferer) {
      pc.createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => poker.sendSignal(this._tableId, peerId, { sdp: pc.localDescription }))
        .catch(() => { this.error = "Couldn't start the call."; });
    }
    return pc;
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

  _closePeer(peerId) {
    const pc = this._pcs.get(peerId);
    if (pc) { try { pc.close(); } catch { /* already closed */ } this._pcs.delete(peerId); }
    const el = this._audioEls.get(peerId);
    if (el) { el.srcObject = null; el.remove(); this._audioEls.delete(peerId); }
    if (this.peers[peerId]) { const p = { ...this.peers }; delete p[peerId]; this.peers = p; }
  }
}

export const voice = new Voice();
