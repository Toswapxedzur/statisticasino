// Universal match recorder — captures the deterministic inputs of one hand /
// round (initial deck order + config + players + the ordered action log) plus
// the final outcome, for EVERY game mode. Because the engines are pure
// (state in → state out), a stored payload can be re-simulated step by step to
// reconstruct the whole match; the `final` summary is kept alongside so a
// replay still renders if an engine's behaviour ever drifts from an old
// recording.
//
// One instance per live hand/round; the table loop feeds it every applied
// action (human, bot, and timeout autos alike) and persists the payload at
// completion via store.persistReplay().

export class MatchRecorder {
  // meta: { mode, variant?, context, tableId, tableName, handNo, startedAt,
  //         config, players:[{seat,userId,name,stack}], buttonSeat?,
  //         bankerSeat?, deck }
  constructor(meta, now = () => Date.now()) {
    this.meta = meta;
    this.now = now;
    this.actions = [];
  }

  // Append one applied action. `auto` marks timeout/disconnect auto-actions.
  action(seat, action, auto = false) {
    if (!action || typeof action !== "object") return;
    const { seat: _seat, ...rest } = action;
    const rec = { s: seat, t: Math.max(0, this.now() - this.meta.startedAt), ...rest };
    if (auto) rec.auto = 1;
    this.actions.push(rec);
  }

  // The replay_json document. `final` is a mode-appropriate outcome summary
  // (poker: board/pots/showdown; modules: the game's publicView + results).
  payload(final = null) {
    const m = this.meta;
    return {
      v: 1,
      mode: m.mode,
      variant: m.variant ?? null,
      config: m.config ?? null,
      players: m.players,
      buttonSeat: m.buttonSeat ?? null,
      bankerSeat: m.bankerSeat ?? null,
      deck: m.deck,
      actions: this.actions,
      final
    };
  }
}
