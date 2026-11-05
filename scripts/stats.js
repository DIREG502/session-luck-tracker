/**
 * @file Pure statistics and data-model functions for Session Luck Tracker.
 *
 * Nothing in this file touches Foundry globals (`game`, `ui`, `foundry`, ...),
 * so it can be imported and unit-tested in plain Node.
 *
 * @module session-luck-tracker/stats
 */

/** Number of faces of the main metric die. */
export const D20 = 20;

/** Shortest streak that qualifies for a streak award. */
export const MIN_STREAK_FOR_AWARD = 3;

/** PF2e degree-of-success identifiers, best to worst. */
export const OUTCOMES = Object.freeze(["criticalSuccess", "success", "failure", "criticalFailure"]);

/** Recursion guard for deeply nested roll term trees. */
const MAX_TERM_DEPTH = 32;

// ---------------------------------------------------------------------------
// Basic die math
// ---------------------------------------------------------------------------

/**
 * Whether `faces` describes a real die with at least two faces.
 * @param {number} faces
 * @returns {boolean}
 */
export function isValidFaces(faces) {
  return Number.isInteger(faces) && faces >= 2;
}

/**
 * Expected value of a fair die: (faces + 1) / 2.
 * @param {number} faces
 * @returns {number}
 */
export function dieMean(faces) {
  return (faces + 1) / 2;
}

/**
 * Standard deviation of a fair die: sqrt((faces^2 - 1) / 12).
 * @param {number} faces
 * @returns {number}
 */
export function dieStdDev(faces) {
  return Math.sqrt((faces * faces - 1) / 12);
}

/** Expected mean of a d20 (10.5). */
export const D20_MEAN = dieMean(D20);

/** Standard deviation of a d20 (~5.766). */
export const D20_STD_DEV = dieStdDev(D20);

/**
 * Arithmetic mean.
 * @param {number[]} values
 * @returns {number|null} `null` for an empty list.
 */
export function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Z-score of a sample mean of `n` rolls of a fair die:
 * z = (mean - μ) / (σ / sqrt(n)).
 *
 * @param {number|null} sampleMean
 * @param {number} n
 * @param {number} [faces=20]
 * @returns {number|null} `null` if there is no data.
 */
export function zScore(sampleMean, n, faces = D20) {
  if (!Number.isFinite(sampleMean) || !Number.isFinite(n) || n <= 0 || !isValidFaces(faces)) return null;
  return (sampleMean - dieMean(faces)) / (dieStdDev(faces) / Math.sqrt(n));
}

/**
 * Deviation of a single result from the die's mean, in standard deviations:
 * (result - (faces + 1) / 2) / sqrt((faces^2 - 1) / 12).
 *
 * @param {number} value
 * @param {number} faces
 * @returns {number|null}
 */
export function normalizedDeviation(value, faces) {
  if (!isValidFaces(faces) || !Number.isFinite(value)) return null;
  return (value - dieMean(faces)) / dieStdDev(faces);
}

// ---------------------------------------------------------------------------
// Roll parsing (duck-typed so it can run without Foundry)
// ---------------------------------------------------------------------------

/**
 * @typedef {object} DieResult
 * @property {number} faces  Number of faces of the die.
 * @property {number} value  The face that came up.
 */

/**
 * Default "is this a Die term?" predicate used when Foundry classes are unavailable.
 * Foundry's tracker passes `t => t instanceof foundry.dice.terms.Die` instead.
 * @param {any} term
 * @returns {boolean}
 */
export function isDieLike(term) {
  return !!term && typeof term === "object" && typeof term.faces === "number" && Array.isArray(term.results);
}

/** Keys holding arrays of nested terms or rolls (Roll, PoolTerm, FunctionTerm, pf2e ArithmeticExpression...). */
const CHILD_ARRAY_KEYS = ["terms", "rolls", "operands", "dice"];
/** Keys holding a single nested term or roll (ParentheticalTerm, pf2e Grouping / IntermediateDie...). */
const CHILD_OBJECT_KEYS = ["roll", "term", "die"];

/**
 * Collect every *active* die result from a roll (or a single term), walking nested
 * pools, parenthetical terms and function terms. Results with `active !== true`
 * (dropped by keep/drop modifiers, rerolled, ...) are ignored. Non-dice terms,
 * empty results and malformed data are skipped silently.
 *
 * @param {object} root                         A Roll, RollTerm or plain serialized equivalent.
 * @param {(term: any) => boolean} [isDie]      Predicate that identifies Die terms.
 * @returns {DieResult[]}
 */
export function extractActiveDice(root, isDie = isDieLike) {
  /** @type {DieResult[]} */
  const found = [];
  const seen = new Set();

  const visit = (node, depth) => {
    if (!node || typeof node !== "object" || seen.has(node) || depth > MAX_TERM_DEPTH) return;
    seen.add(node);

    if (isDie(node)) {
      collectDieResults(node, found);
      return;
    }

    for (const key of CHILD_ARRAY_KEYS) {
      let children;
      try { children = node[key]; } catch { continue; } // getters may throw on unevaluated rolls
      if (Array.isArray(children)) for (const child of children) visit(child, depth + 1);
    }
    for (const key of CHILD_OBJECT_KEYS) {
      let child;
      try { child = node[key]; } catch { continue; }
      if (child && typeof child === "object") visit(child, depth + 1);
    }
  };

  visit(root, 0);
  return found;
}

/**
 * Push the active results of a single die term into `out`.
 * @param {{faces: number, results?: Array<{result: number, active?: boolean}>}} term
 * @param {DieResult[]} out
 */
function collectDieResults(term, out) {
  const faces = Number(term.faces);
  if (!isValidFaces(faces)) return;
  const results = Array.isArray(term.results) ? term.results : [];
  for (const r of results) {
    if (!r || r.active !== true) continue;
    const value = Number(r.result);
    if (!Number.isFinite(value) || value < 1 || value > faces) continue;
    out.push({ faces, value });
  }
}

// ---------------------------------------------------------------------------
// Data model helpers (pure; mutate only the record passed in)
// ---------------------------------------------------------------------------

/**
 * @typedef {object} PlayerRecord
 * @property {string} userId
 * @property {string} name                          User name at the time of the last roll.
 * @property {string|null} color                    User color (#rrggbb) or null.
 * @property {Record<string, number>} characters    Character name -> number of roll messages.
 * @property {number[]} d20                         Ordered active d20 results.
 * @property {Record<string, {count: number, sum: number}>} dice  Per-face totals (includes d20).
 * @property {Record<string, number>} outcomes      PF2e degree-of-success counters.
 * @property {number} rolls                         Counted Roll objects.
 * @property {number} messages                      Counted chat messages.
 */

/**
 * Create an empty player record.
 * @param {string} userId
 * @param {string} name
 * @param {string|null} [color]
 * @returns {PlayerRecord}
 */
export function createPlayerRecord(userId, name, color = null) {
  return {
    userId,
    name,
    color,
    characters: {},
    d20: [],
    dice: {},
    outcomes: Object.fromEntries(OUTCOMES.map((o) => [o, 0])),
    rolls: 0,
    messages: 0
  };
}

/**
 * Add die results to a player record.
 * @param {PlayerRecord} player
 * @param {DieResult[]} dice
 */
export function addDiceToPlayer(player, dice) {
  for (const { faces, value } of dice) {
    const bucket = (player.dice[faces] ??= { count: 0, sum: 0 });
    bucket.count += 1;
    bucket.sum += value;
    if (faces === D20) player.d20.push(value);
  }
}

/**
 * Increment a PF2e degree-of-success counter. Unknown outcomes are ignored.
 * @param {PlayerRecord} player
 * @param {string} outcome
 */
export function addOutcomeToPlayer(player, outcome) {
  if (!OUTCOMES.includes(outcome)) return;
  player.outcomes ??= {};
  player.outcomes[outcome] = (player.outcomes[outcome] ?? 0) + 1;
}

/**
 * Remember a character name the player rolled as.
 * @param {PlayerRecord} player
 * @param {string|null} characterName
 */
export function addCharacterToPlayer(player, characterName) {
  if (!characterName) return;
  player.characters ??= {};
  player.characters[characterName] = (player.characters[characterName] ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

/**
 * Longest consecutive runs of high (>= 11) and low (<= 10) d20 results.
 * @param {number[]} results
 * @returns {{hot: number, cold: number}}
 */
export function longestStreaks(results) {
  let hot = 0, cold = 0, curHot = 0, curCold = 0;
  for (const v of results ?? []) {
    if (v >= 11) { curHot += 1; curCold = 0; }
    else { curCold += 1; curHot = 0; }
    if (curHot > hot) hot = curHot;
    if (curCold > cold) cold = curCold;
  }
  return { hot, cold };
}

/**
 * @typedef {object} D20Summary
 * @property {number} count
 * @property {number} sum
 * @property {number|null} mean
 * @property {number} nat20
 * @property {number} nat1
 * @property {number} deviationSum     sum(result - 10.5)
 * @property {number|null} meanDeviation
 * @property {number|null} z
 * @property {number} hotStreak
 * @property {number} coldStreak
 */

/**
 * Summarize a list of d20 results.
 * @param {number[]} results
 * @returns {D20Summary}
 */
export function summarizeD20(results) {
  const list = Array.isArray(results) ? results : [];
  let sum = 0, nat20 = 0, nat1 = 0;
  for (const v of list) {
    sum += v;
    if (v === 20) nat20 += 1;
    else if (v === 1) nat1 += 1;
  }
  const count = list.length;
  const avg = count ? sum / count : null;
  const { hot, cold } = longestStreaks(list);
  return {
    count,
    sum,
    mean: avg,
    nat20,
    nat1,
    deviationSum: sum - count * D20_MEAN,
    meanDeviation: count ? avg - D20_MEAN : null,
    z: zScore(avg, count, D20),
    hotStreak: hot,
    coldStreak: cold
  };
}

/**
 * Universal luck index: the mean normalized deviation across all dice of any size.
 * Also returns a combined z-score (sum of normalized deviations / sqrt(n)).
 *
 * @param {Record<string, {count: number, sum: number}>} diceByFaces
 * @returns {{count: number, index: number|null, z: number|null}}
 */
export function universalIndex(diceByFaces) {
  let count = 0, total = 0;
  for (const [key, bucket] of Object.entries(diceByFaces ?? {})) {
    const faces = Number(key);
    const n = Number(bucket?.count) || 0;
    const sum = Number(bucket?.sum) || 0;
    if (!isValidFaces(faces) || n <= 0) continue;
    total += (sum - n * dieMean(faces)) / dieStdDev(faces);
    count += n;
  }
  return {
    count,
    index: count ? total / count : null,
    z: count ? total / Math.sqrt(count) : null
  };
}

/**
 * Most frequently used character name, ignoring the player's own name.
 * @param {Record<string, number>} characters
 * @param {string} [playerName]
 * @returns {string[]} Names sorted by frequency (most used first).
 */
export function sortedCharacters(characters, playerName) {
  return Object.entries(characters ?? {})
    .filter(([name]) => name && name !== playerName)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

/**
 * @typedef {object} StatsOptions
 * @property {number} [minRolls=5]   Minimum sample size for Luckiest / Unluckiest.
 * @property {boolean} [d20Only=true] Rank by mean d20 (true) or by universal index (false).
 * @property {number} [now]           Timestamp used as the end of a still running session.
 */

/**
 * @typedef {object} PlayerRow
 * @property {string} userId
 * @property {string} name
 * @property {string|null} color
 * @property {string[]} characters
 * @property {D20Summary} d20
 * @property {{count: number, index: number|null, z: number|null}} universal
 * @property {Record<string, number>} outcomes
 * @property {number} rolls
 * @property {number} messages
 * @property {number} sampleSize   Rolls considered for eligibility.
 * @property {number|null} score   Ranking value (mean d20 or universal index).
 * @property {boolean} eligible    Whether the player can win Luckiest / Unluckiest.
 */

/**
 * Build a statistics row for one player.
 * @param {PlayerRecord} player
 * @param {StatsOptions} [options]
 * @returns {PlayerRow}
 */
export function buildPlayerRow(player, { minRolls = 5, d20Only = true } = {}) {
  const d20 = summarizeD20(player?.d20);
  const universal = universalIndex(player?.dice);
  const sampleSize = d20Only ? d20.count : universal.count;
  const score = d20Only ? d20.mean : universal.index;
  const outcomes = Object.fromEntries(OUTCOMES.map((o) => [o, Number(player?.outcomes?.[o]) || 0]));
  return {
    userId: player?.userId ?? "",
    name: player?.name ?? "?",
    color: player?.color ?? null,
    characters: sortedCharacters(player?.characters, player?.name),
    d20,
    universal,
    outcomes,
    rolls: Number(player?.rolls) || 0,
    messages: Number(player?.messages) || 0,
    sampleSize,
    score,
    eligible: score !== null && sampleSize >= minRolls
  };
}

/**
 * Sort rows for display: eligible players first, then by score (best first),
 * then by sample size, then by name. Players without a score go last.
 * @param {PlayerRow[]} rows
 * @returns {PlayerRow[]} A new sorted array.
 */
export function sortRows(rows) {
  return [...rows].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if ((a.score === null) !== (b.score === null)) return a.score === null ? 1 : -1;
    if (a.score !== null && a.score !== b.score) return b.score - a.score;
    if (a.sampleSize !== b.sampleSize) return b.sampleSize - a.sampleSize;
    return String(a.name).localeCompare(String(b.name));
  });
}

/**
 * @typedef {object} Award
 * @property {PlayerRow[]} rows  Winners (more than one on a tie).
 * @property {number} value      The winning value.
 */

/**
 * Pick the rows with the extreme value of `getValue`.
 * @param {PlayerRow[]} rows
 * @param {(row: PlayerRow) => number|null} getValue
 * @param {"max"|"min"} direction
 * @param {number} [minValue]  Values below this never win (used for counts and streaks).
 * @returns {Award|null}
 */
export function pickExtreme(rows, getValue, direction, minValue = -Infinity) {
  let best = null;
  let winners = [];
  for (const row of rows) {
    const value = getValue(row);
    if (value === null || value === undefined || !Number.isFinite(value) || value < minValue) continue;
    const better = best === null || (direction === "max" ? value > best : value < best);
    if (better) { best = value; winners = [row]; }
    else if (value === best) winners.push(row);
  }
  return best === null ? null : { rows: winners, value: best };
}

/**
 * @typedef {object} Awards
 * @property {Award|null} luckiest
 * @property {Award|null} unluckiest
 * @property {Award|null} mostNat20
 * @property {Award|null} mostNat1
 * @property {Award|null} hotStreak
 * @property {Award|null} coldStreak
 */

/**
 * Compute all awards. Luckiest / Unluckiest only consider eligible players;
 * Unluckiest requires at least two eligible players with different scores.
 * @param {PlayerRow[]} rows
 * @returns {Awards}
 */
export function computeAwards(rows) {
  const eligible = rows.filter((r) => r.eligible);
  const luckiest = pickExtreme(eligible, (r) => r.score, "max");
  let unluckiest = eligible.length >= 2 ? pickExtreme(eligible, (r) => r.score, "min") : null;
  if (luckiest && unluckiest && luckiest.value === unluckiest.value) unluckiest = null;
  return {
    luckiest,
    unluckiest,
    mostNat20: pickExtreme(rows, (r) => r.d20.nat20, "max", 1),
    mostNat1: pickExtreme(rows, (r) => r.d20.nat1, "max", 1),
    hotStreak: pickExtreme(rows, (r) => r.d20.hotStreak, "max", MIN_STREAK_FOR_AWARD),
    coldStreak: pickExtreme(rows, (r) => r.d20.coldStreak, "max", MIN_STREAK_FOR_AWARD)
  };
}

/**
 * @typedef {object} SessionStats
 * @property {string|null} sessionId
 * @property {number|null} start
 * @property {number|null} end
 * @property {number} duration     Milliseconds.
 * @property {boolean} active      Whether the session was still running.
 * @property {string} world
 * @property {string} system
 * @property {number} minRolls
 * @property {boolean} d20Only
 * @property {PlayerRow[]} rows
 * @property {Awards} awards
 * @property {object} totals
 * @property {boolean} hasOutcomes Whether any PF2e degree-of-success data exists.
 */

/**
 * Compute complete statistics for a stored session object.
 * @param {object} session   Session as stored by the tracker.
 * @param {StatsOptions} [options]
 * @returns {SessionStats}
 */
export function computeSessionStats(session, options = {}) {
  const minRolls = Math.max(0, Math.floor(Number(options.minRolls ?? 5) || 0));
  const d20Only = options.d20Only !== false;
  const players = Object.values(session?.players ?? {});
  const rows = sortRows(players.map((p) => buildPlayerRow(p, { minRolls, d20Only })));

  let d20Count = 0, d20Sum = 0, nat20 = 0, nat1 = 0, diceCount = 0, rolls = 0;
  const outcomes = Object.fromEntries(OUTCOMES.map((o) => [o, 0]));
  for (const row of rows) {
    d20Count += row.d20.count;
    d20Sum += row.d20.sum;
    nat20 += row.d20.nat20;
    nat1 += row.d20.nat1;
    diceCount += row.universal.count;
    rolls += row.rolls;
    for (const o of OUTCOMES) outcomes[o] += row.outcomes[o];
  }
  const d20Mean = d20Count ? d20Sum / d20Count : null;

  const start = Number.isFinite(session?.start) ? session.start : null;
  const end = Number.isFinite(session?.end) ? session.end : (Number.isFinite(options.now) ? options.now : start);
  const duration = start !== null && end !== null ? Math.max(0, end - start) : 0;

  return {
    sessionId: session?.id ?? null,
    start,
    end,
    duration,
    active: !!session?.active,
    world: session?.world ?? "",
    system: session?.system ?? "",
    minRolls,
    d20Only,
    rows,
    awards: computeAwards(rows),
    totals: {
      players: rows.length,
      messages: Number(session?.counts?.messages) || rows.reduce((s, r) => s + r.messages, 0),
      rolls,
      diceCount,
      d20Count,
      d20Mean,
      d20Z: zScore(d20Mean, d20Count, D20),
      nat20,
      nat1,
      outcomes
    },
    hasOutcomes: OUTCOMES.some((o) => outcomes[o] > 0)
  };
}

/**
 * Split a duration into whole hours and minutes.
 * @param {number} ms
 * @returns {{hours: number, minutes: number, totalMinutes: number}}
 */
export function splitDuration(ms) {
  const totalMinutes = Math.max(0, Math.floor((Number(ms) || 0) / 60000));
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60, totalMinutes };
}
