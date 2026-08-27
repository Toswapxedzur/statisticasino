// Out-of-game friend voice calls (Phase E). This is a thin CALL-LIFECYCLE layer
// (ring / accept / decline / hang-up) on top of the existing table-voice mesh:
// once a call goes 'active', both peers join the DM conversation's voice room
// (`voice.join(room)`) and the WebRTC mesh in voice.svelte.js carries the audio.
//
// Call state itself lives on the poker store ($state) so any component can read
// it: `poker.incomingCall` (someone ringing me) and `poker.call` (my current
// outgoing/active call). This controller owns the transitions + voice join/leave.

import { browser } from "$app/environment";
import { poker } from "./client.svelte.js";
import { voice } from "./voice.svelte.js";

const ENDED_MSG = {
  declined: "Call declined",
  busy: "They're on another call",
  unavailable: "They're offline right now",
  ended: "Call ended",
};

class Calls {
  constructor() {
    if (browser) poker.setCallHandlers({ state: (m) => this._onState(m) });
  }

  // Convenience reads for the UI.
  get muted() { return voice.muted; }
  get peers() { return voice.peers; }

  // Start calling a friend (out of game).
  start(userId, name) {
    if (poker.call || poker.incomingCall) return;
    poker.call = { callId: null, state: "calling", peer: { userId, name: name || "Player" }, outgoing: true };
    poker.startCall(userId);
  }

  accept() {
    const inc = poker.incomingCall;
    if (!inc) return;
    poker.call = { callId: inc.callId, state: "connecting", peer: { userId: inc.fromUserId, name: inc.fromName } };
    poker.incomingCall = null;
    poker.acceptCall(inc.callId);
  }

  decline() {
    const inc = poker.incomingCall;
    if (!inc) return;
    poker.declineCall(inc.callId);
    poker.incomingCall = null;
  }

  hangup() {
    if (poker.call?.callId) poker.endCall(poker.call.callId);
    this._teardown();
  }

  toggleMute() { voice.toggleMute(); }

  // ---- server-driven ----

  _onState(msg) {
    const { callId, state, peer, room } = msg;
    if (state === "ringing") {
      // Server acknowledged our outgoing invite is now ringing at them.
      poker.call = { callId, state: "ringing", peer, outgoing: true };
      return;
    }
    if (state === "active") {
      poker.call = { callId, state: "active", peer, room };
      poker.incomingCall = null;
      voice.join(room); // media plane: existing mesh over the DM's voice room
      return;
    }
    // ended | declined | busy | unavailable
    this._teardown();
    poker.toast = { level: "info", text: ENDED_MSG[state] || "Call ended" };
  }

  _teardown() {
    if (voice.active) voice.leave();
    poker.call = null;
    poker.incomingCall = null;
  }
}

export const calls = new Calls();
