// Player statistics built on the universal v22 match recorder.
//
// Exact match/mode/daily aggregates stay in SQL. Poker's expensive behavioural
// rates are derived from at most the newest 400 recorded poker hands and cached
// for 60 seconds per user. Lifetime poker hand/net totals also include legacy
// poker_hand rows, excluding any cash hand that has a matching v22 replay so a
// newly-recorded cash hand is never counted twice.

import { query } from "./db.js";
import { applyAction, createHand } from "./poker/engine/index.js";

const CONTEXTS = ["cash", "tournament", "sprint"];
const POKER_REPLAY_LIMIT = 400;
const POKER_CACHE_TTL_MS = 60_000;

function numeric(value) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function rounded(value, digits = 1) {
  const scale = 10 ** digits;
  const result = Math.round((numeric(value) + Number.EPSILON) * scale) / scale;
  return Object.is(result, -0) ? 0 : result;
}

function rate(part, total) {
  return total > 0 ? rounded((part / total) * 100, 1) : 0;
}

function normaliseSince(sinceMs) {
  if (sinceMs === null || sinceMs === undefined || sinceMs === "") return null;
  const value = Number(sinceMs);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : null;
}

function emptyContext(context) {
  return {
    context,
    matches: 0,
    net: 0,
    daysActive: 0,
    biggestWin: 0,
    wins: 0,
    winRate: 0
  };
}

function aggregateRow(row, names = {}) {
  const matches = numeric(row?.[names.matches || "matches"]);
  const wins = numeric(row?.[names.wins || "wins"]);
  return {
    matches,
    net: numeric(row?.[names.net || "net"]),
    daysActive: numeric(row?.[names.daysActive || "days_active"]),
    biggestWin: numeric(row?.[names.biggestWin || "biggest_win"]),
    wins,
    winRate: rate(wins, matches)
  };
}

function parseReplay(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function playerId(player, index) {
  const recorded = player?.userId;
  if (recorded !== null && recorded !== undefined && recorded !== "") return String(recorded);
  return `recorded-seat-${numeric(player?.seat)}-${index}`;
}

function engineConfig(replay, row) {
  const config = replay.config && typeof replay.config === "object" ? replay.config : {};
  return {
    ...config,
    players: (replay.players || []).map((player, index) => ({
      seat: numeric(player?.seat),
      stack: numeric(player?.stack),
      id: playerId(player, index)
    })),
    buttonSeat: numeric(replay.buttonSeat),
    smallBlind: numeric(config.smallBlind),
    bigBlind: numeric(config.bigBlind),
    variant: replay.variant || row?.variant || "holdem",
    deck: Array.isArray(replay.deck) ? [...replay.deck] : replay.deck
  };
}

function isAggressiveAllIn(state, seat) {
  const player = state?.players?.find((candidate) => candidate.seat === seat);
  if (!player) return false;
  return numeric(player.committedThisStreet) + numeric(player.stack) > numeric(state.currentBet);
}

// Re-simulation is the street classifier. The recorder omits blind posts, while
// createHand() deterministically restores them from config/deck/players. Reading
// state.street immediately before each applyAction() therefore gives exact
// preflop membership for every successfully replayed Hold'em-family action.
// Five-card draw and stud have no "preflop" street, so they contribute to poker
// totals/showdowns/aggression but not the VPIP/PFR opportunity denominator.
export function analyzePokerReplay(row) {
  const replay = parseReplay(row?.replay_json ?? row?.replayJson ?? row?.replay);
  if (!replay || !Array.isArray(replay.actions) || !Array.isArray(replay.players)) return null;

  const seat = numeric(row?.seat);
  const net = numeric(row?.net);
  const result = replay.final?.result;
  const revealed = Array.isArray(result?.revealed) ? result.revealed : [];
  const showdownSeen = result?.type === "showdown" && revealed.some((hand) => numeric(hand?.seat) === seat);

  let calls = 0;
  let betsRaises = 0;
  for (const action of replay.actions) {
    if (numeric(action?.s) !== seat) continue;
    if (action.type === "call") calls += 1;
    if (action.type === "bet" || action.type === "raise") betsRaises += 1;
  }

  let state;
  let engineOk = true;
  let preflopEligible = false;
  let preflopValid = false;
  let vpip = false;
  let pfr = false;

  try {
    state = createHand(engineConfig(replay, row));
    preflopEligible = state.street === "preflop";
    preflopValid = preflopEligible;

    for (const recorded of replay.actions) {
      const actionSeat = numeric(recorded?.s);
      const street = state.street;
      if (actionSeat === seat) {
        if (street === "preflop") {
          if (["call", "bet", "raise", "allin"].includes(recorded.type)) vpip = true;
          if (["bet", "raise", "allin"].includes(recorded.type)) pfr = true;
        }
        if (recorded.type === "allin" && isAggressiveAllIn(state, actionSeat)) betsRaises += 1;
      }

      const { s: _seat, t: _time, auto: _auto, ...action } = recorded;
      state = applyAction(state, { seat: actionSeat, ...action }).state;
    }
  } catch {
    engineOk = false;
    if (state?.street === "preflop") preflopValid = false;
  }

  return {
    endedAt: numeric(row?.ended_at ?? row?.endedAt),
    variant: replay.variant || row?.variant || "holdem",
    context: row?.context || "cash",
    engineOk,
    preflopEligible,
    preflopValid,
    vpip,
    pfr,
    calls,
    betsRaises,
    showdownSeen,
    showdownWon: showdownSeen && net > 0,
    potWon: net > 0 ? numeric(row?.pot_total ?? row?.potTotal) : 0
  };
}

function pokerAggregate(observations, sinceMs, recordedHands) {
  const selected = observations.filter((hand) => sinceMs === null || hand.endedAt >= sinceMs);
  const preflopHands = selected.filter((hand) => hand.preflopEligible && hand.preflopValid);
  const vpipHands = preflopHands.filter((hand) => hand.vpip).length;
  const pfrHands = preflopHands.filter((hand) => hand.pfr).length;
  const betsRaises = selected.reduce((sum, hand) => sum + hand.betsRaises, 0);
  const calls = selected.reduce((sum, hand) => sum + hand.calls, 0);
  const showdownsSeen = selected.filter((hand) => hand.showdownSeen).length;
  const showdownsWon = selected.filter((hand) => hand.showdownWon).length;

  return {
    sampleHands: selected.length,
    recordedHands: sinceMs === null
      ? recordedHands
      : selected.length,
    replayErrors: selected.filter((hand) => !hand.engineOk).length,
    preflopHands: preflopHands.length,
    vpipHands,
    vpip: rate(vpipHands, preflopHands.length),
    pfrHands,
    pfr: rate(pfrHands, preflopHands.length),
    aggressionFactor: calls > 0 ? rounded(betsRaises / calls, 2) : null,
    betsRaises,
    calls,
    showdownsSeen,
    showdownsWon,
    showdownWinRate: rate(showdownsWon, showdownsSeen),
    biggestPotWon: selected.reduce((best, hand) => Math.max(best, hand.potWon), 0)
  };
}

export function createStatsService(queryFn = query, { now = () => Date.now() } = {}) {
  if (typeof queryFn !== "function") throw new TypeError("queryFn must be a function");
  const pokerCache = new Map();

  async function overviewStats(userId, { sinceMs = null } = {}) {
    if (!userId) {
      const contexts = CONTEXTS.map(emptyContext);
      return { ...aggregateRow(null, { net: "total_net" }), totalNet: 0, contexts, byContext: Object.fromEntries(contexts.map((item) => [item.context, item])) };
    }
    const since = normaliseSince(sinceMs);
    const sinceSql = since === null ? "" : " AND mrp.ended_at >= ?";
    const params = since === null ? [userId] : [userId, since];
    const [totalRows, contextRows] = await Promise.all([
      queryFn(
        `/* stats:overview-total */
         SELECT COUNT(*) AS matches,
                COALESCE(SUM(mrp.net), 0) AS total_net,
                COUNT(DISTINCT DATE_FORMAT(FROM_UNIXTIME(mrp.ended_at / 1000), '%Y-%m-%d')) AS days_active,
                COALESCE(MAX(CASE WHEN mrp.net > 0 THEN mrp.net ELSE 0 END), 0) AS biggest_win,
                COALESCE(SUM(CASE WHEN mrp.net > 0 THEN 1 ELSE 0 END), 0) AS wins
         FROM match_replay_player mrp
         WHERE mrp.user_id = ?${sinceSql}`,
        params
      ),
      queryFn(
        `/* stats:overview-context */
         SELECT mr.context,
                COUNT(*) AS matches,
                COALESCE(SUM(mrp.net), 0) AS net,
                COUNT(DISTINCT DATE_FORMAT(FROM_UNIXTIME(mrp.ended_at / 1000), '%Y-%m-%d')) AS days_active,
                COALESCE(MAX(CASE WHEN mrp.net > 0 THEN mrp.net ELSE 0 END), 0) AS biggest_win,
                COALESCE(SUM(CASE WHEN mrp.net > 0 THEN 1 ELSE 0 END), 0) AS wins
         FROM match_replay_player mrp
         JOIN match_replay mr ON mr.id = mrp.replay_id
         WHERE mrp.user_id = ?${sinceSql}
         GROUP BY mr.context`,
        params
      )
    ]);

    const total = aggregateRow(totalRows[0], { net: "total_net" });
    const contextMap = new Map(contextRows.map((row) => [row.context || "cash", aggregateRow(row)]));
    const contexts = CONTEXTS.map((context) => ({ context, ...(contextMap.get(context) || emptyContext(context)) }));
    return {
      ...total,
      totalNet: total.net,
      contexts,
      byContext: Object.fromEntries(contexts.map((item) => [item.context, item]))
    };
  }

  async function modeBreakdown(userId, { sinceMs = null } = {}) {
    if (!userId) return [];
    const since = normaliseSince(sinceMs);
    const sinceSql = since === null ? "" : " AND ended_at >= ?";
    const params = since === null ? [userId] : [userId, since];
    const rows = await queryFn(
      `/* stats:mode-breakdown */
       SELECT mode, role,
              COUNT(*) AS matches,
              COALESCE(SUM(net), 0) AS net,
              COALESCE(SUM(CASE WHEN net > 0 THEN 1 ELSE 0 END), 0) AS wins,
              COALESCE(MAX(CASE WHEN net > 0 THEN net ELSE 0 END), 0) AS biggest_win,
              MAX(ended_at) AS last_played
       FROM match_replay_player
       WHERE user_id = ?${sinceSql}
       GROUP BY mode, role
       ORDER BY last_played DESC, mode ASC, role ASC`,
      params
    );
    return rows.map((row) => {
      const matches = numeric(row.matches);
      const wins = numeric(row.wins);
      return {
        mode: row.mode || "unknown",
        role: row.role === "banker" ? "banker" : "player",
        matches,
        net: numeric(row.net),
        wins,
        winRate: rate(wins, matches),
        biggestWin: numeric(row.biggest_win),
        lastPlayed: numeric(row.last_played)
      };
    });
  }

  async function dailyNet(userId, { sinceMs = null } = {}) {
    if (!userId) return [];
    const since = normaliseSince(sinceMs);
    const sinceSql = since === null ? "" : " AND ended_at >= ?";
    const params = since === null ? [userId] : [userId, since];
    const rows = await queryFn(
      `/* stats:daily-net */
       SELECT DATE_FORMAT(FROM_UNIXTIME(ended_at / 1000), '%Y-%m-%d') AS day,
              COALESCE(SUM(net), 0) AS net,
              COUNT(*) AS matches
       FROM match_replay_player
       WHERE user_id = ?${sinceSql}
       GROUP BY day
       ORDER BY day ASC`,
      params
    );
    return rows.map((row) => ({ day: String(row.day), net: numeric(row.net), matches: numeric(row.matches) }));
  }

  async function exactPokerTotals(userId, since) {
    const replaySince = since === null ? "" : " AND mrp.ended_at >= ?";
    const legacySince = since === null ? "" : " AND ph.ended_at >= ?";
    const params = [userId];
    if (since !== null) params.push(since);
    params.push(userId);
    if (since !== null) params.push(since);

    const rows = await queryFn(
      `/* stats:poker-totals */
       SELECT COUNT(*) AS hands, COALESCE(SUM(poker_matches.net), 0) AS net
       FROM (
         SELECT mrp.replay_id AS source_id, mrp.net
         FROM match_replay_player mrp
         WHERE mrp.user_id = ?
           AND mrp.mode = 'holdem'
           AND mrp.role = 'player'${replaySince}

         UNION ALL

         SELECT php.hand_id AS source_id, php.net
         FROM poker_hand_player php
         JOIN poker_hand ph ON ph.id = php.hand_id
         WHERE php.user_id = ?${legacySince}
           AND NOT EXISTS (
             SELECT 1
             FROM match_replay mr
             JOIN match_replay_player mrp2 ON mrp2.replay_id = mr.id
             WHERE mr.mode = 'holdem'
               AND mr.context = 'cash'
               AND mr.table_id = ph.table_id
               AND mr.hand_no = ph.hand_no
               AND mrp2.user_id = php.user_id
               AND mrp2.role = 'player'
           )
       ) poker_matches`,
      params
    );
    return { hands: numeric(rows[0]?.hands), net: numeric(rows[0]?.net) };
  }

  async function parsedPokerHands(userId) {
    const key = String(userId);
    const cached = pokerCache.get(key);
    const at = now();
    if (cached && at - cached.at < POKER_CACHE_TTL_MS) return cached.data;

    const rows = await queryFn(
      `/* stats:poker-replays */
       SELECT mr.id, mr.variant, mr.context, mr.ended_at, mr.pot_total, mr.replay_json,
              mrp.seat, mrp.net
       FROM match_replay_player mrp
       JOIN match_replay mr ON mr.id = mrp.replay_id
       WHERE mrp.user_id = ?
         AND mrp.mode = 'holdem'
         AND mrp.role = 'player'
       ORDER BY mr.ended_at DESC
       LIMIT ${POKER_REPLAY_LIMIT}`,
      [userId]
    );
    const data = {
      recordedHands: rows.length,
      observations: rows.map(analyzePokerReplay).filter(Boolean)
    };
    pokerCache.set(key, { at, data });
    return data;
  }

  async function pokerStats(userId, { sinceMs = null } = {}) {
    if (!userId) {
      return {
        hands: 0, net: 0, sampleHands: 0, recordedHands: 0, replayErrors: 0,
        preflopHands: 0, vpipHands: 0, vpip: 0, pfrHands: 0, pfr: 0,
        aggressionFactor: null, betsRaises: 0, calls: 0, showdownsSeen: 0,
        showdownsWon: 0, showdownWinRate: 0, biggestPotWon: 0
      };
    }
    const since = normaliseSince(sinceMs);
    const [totals, parsed] = await Promise.all([
      exactPokerTotals(userId, since),
      parsedPokerHands(userId)
    ]);
    return {
      ...totals,
      ...pokerAggregate(parsed.observations, since, parsed.recordedHands)
    };
  }

  return { overviewStats, modeBreakdown, pokerStats, dailyNet };
}

const defaultStats = createStatsService(query);

export const overviewStats = (...args) => defaultStats.overviewStats(...args);
export const modeBreakdown = (...args) => defaultStats.modeBreakdown(...args);
export const pokerStats = (...args) => defaultStats.pokerStats(...args);
export const dailyNet = (...args) => defaultStats.dailyNet(...args);

