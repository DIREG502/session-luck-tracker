/**
 * Unit tests for scripts/stats.js. Run with: node --test tests/
 * No Foundry VTT required.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  D20_MEAN,
  D20_STD_DEV,
  mean,
  dieMean,
  dieStdDev,
  zScore,
  normalizedDeviation,
  extractActiveDice,
  createPlayerRecord,
  addDiceToPlayer,
  addOutcomeToPlayer,
  addCharacterToPlayer,
  summarizeD20,
  longestStreaks,
  universalIndex,
  buildPlayerRow,
  computeSessionStats,
  splitDuration
} from "../scripts/stats.js";

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} ≈ ${expected}`);

/** Build a serialized Die term. results: number | {result, active} */
const die = (faces, results) => ({
  class: "Die",
  faces,
  number: results.length,
  results: results.map((r) => (typeof r === "number" ? { result: r, active: true } : r))
});
const roll = (...terms) => ({ class: "Roll", terms });
const op = (o) => ({ class: "OperatorTerm", operator: o });
const num = (n) => ({ class: "NumericTerm", number: n });

/** Player with the given d20 results. */
function player(id, d20, extra = []) {
  const p = createPlayerRecord(id, `Player ${id}`);
  addDiceToPlayer(p, [...d20.map((value) => ({ faces: 20, value })), ...extra]);
  return p;
}

describe("basic math", () => {
  test("mean", () => {
    assert.equal(mean([1, 2, 3, 4]), 2.5);
    assert.equal(mean([20]), 20);
    assert.equal(mean([]), null);
    assert.equal(mean(undefined), null);
  });

  test("die mean and standard deviation", () => {
    assert.equal(dieMean(20), 10.5);
    assert.equal(dieMean(6), 3.5);
    close(D20_STD_DEV, Math.sqrt(399 / 12));
    close(D20_STD_DEV, 5.766281297335398);
    close(dieStdDev(6), Math.sqrt(35 / 12));
  });

  test("z-score of a d20 mean", () => {
    // (13 - 10.5) / (5.7663 / sqrt(25)) = 2.5 / 1.15326 = 2.1678
    close(zScore(13, 25), 2.5 / (D20_STD_DEV / 5));
    close(zScore(13, 25), 2.16774, 1e-4);
    assert.equal(zScore(10.5, 40), 0);
    assert.ok(zScore(8, 10) < 0);
    // single roll of 20: (20 - 10.5) / 5.7663
    close(zScore(20, 1), 9.5 / D20_STD_DEV);
  });

  test("z-score without data is null", () => {
    assert.equal(zScore(null, 0), null);
    assert.equal(zScore(12, 0), null);
    assert.equal(zScore(NaN, 5), null);
  });

  test("normalized deviation", () => {
    assert.equal(normalizedDeviation(10.5, 20), 0);
    close(normalizedDeviation(20, 20), 9.5 / D20_STD_DEV);
    close(normalizedDeviation(1, 6), -2.5 / dieStdDev(6));
    assert.equal(normalizedDeviation(1, 1), null);
  });
});

describe("extractActiveDice", () => {
  test("plain 1d20 + 5", () => {
    const dice = extractActiveDice(roll(die(20, [14]), op("+"), num(5)));
    assert.deepEqual(dice, [{ faces: 20, value: 14 }]);
  });

  test("excludes dice dropped by keep-highest (advantage)", () => {
    const r = roll(die(20, [
      { result: 7, active: false, discarded: true },
      { result: 16, active: true }
    ]));
    assert.deepEqual(extractActiveDice(r), [{ faces: 20, value: 16 }]);
  });

  test("excludes rerolled results and results without active flag", () => {
    const r = roll(die(6, [
      { result: 1, active: false, rerolled: true },
      { result: 4, active: true },
      { result: 5 } // no active flag -> not counted
    ]));
    assert.deepEqual(extractActiveDice(r), [{ faces: 6, value: 4 }]);
  });

  test("walks pools, parenthetical terms and pf2e-like nesting", () => {
    const pool = { class: "PoolTerm", rolls: [roll(die(20, [3])), roll(die(20, [18]))] };
    const paren = { class: "ParentheticalTerm", term: "1d8 + 2", roll: roll(die(8, [6]), op("+"), num(2)) };
    const grouping = { class: "Grouping", term: { class: "ArithmeticExpression", operands: [die(6, [2]), num(3)] } };
    const dice = extractActiveDice(roll(pool, op("+"), paren, op("+"), grouping));
    assert.deepEqual(dice.map((d) => `${d.faces}:${d.value}`).sort(), ["20:18", "20:3", "6:2", "8:6"].sort());
  });

  test("does not count the same term twice when reachable via several paths", () => {
    const d = die(20, [12]);
    const r = { terms: [d], dice: [d] };
    assert.equal(extractActiveDice(r).length, 1);
  });

  test("handles edge cases gracefully", () => {
    assert.deepEqual(extractActiveDice(null), []);
    assert.deepEqual(extractActiveDice({}), []);
    assert.deepEqual(extractActiveDice(roll()), []);
    assert.deepEqual(extractActiveDice(roll(num(7))), []);
    assert.deepEqual(extractActiveDice(roll(die(20, []))), []);
    assert.deepEqual(extractActiveDice(roll({ faces: 20, results: null })), []);
    // out of range / non-numeric results are ignored
    assert.deepEqual(extractActiveDice(roll(die(20, [{ result: 25, active: true }, { result: "x", active: true }]))), []);
    // invalid faces
    assert.deepEqual(extractActiveDice(roll(die(1, [1]))), []);
  });

  test("custom die predicate is respected", () => {
    const coin = { class: "Coin", faces: 2, results: [{ result: 1, active: true }] };
    const isDie = (t) => t.class === "Die";
    assert.deepEqual(extractActiveDice(roll(coin, die(4, [3])), isDie), [{ faces: 4, value: 3 }]);
  });
});

describe("summaries", () => {
  test("d20 summary", () => {
    const s = summarizeD20([20, 1, 15, 10, 20]);
    assert.equal(s.count, 5);
    assert.equal(s.sum, 66);
    close(s.mean, 13.2);
    assert.equal(s.nat20, 2);
    assert.equal(s.nat1, 1);
    close(s.deviationSum, 66 - 52.5);
    close(s.meanDeviation, 2.7);
    close(s.z, zScore(13.2, 5));
  });

  test("empty d20 summary", () => {
    const s = summarizeD20([]);
    assert.equal(s.count, 0);
    assert.equal(s.mean, null);
    assert.equal(s.z, null);
    assert.equal(s.deviationSum, 0);
  });

  test("streaks", () => {
    // hot: 11,15,20 (3) · cold: 3,10,2,1,1 (5)
    assert.deepEqual(longestStreaks([11, 15, 20, 3, 10, 2, 1, 1, 12]), { hot: 3, cold: 5 });
    assert.deepEqual(longestStreaks([12, 12, 9, 13, 14, 15, 16]), { hot: 4, cold: 1 });
    assert.deepEqual(longestStreaks([]), { hot: 0, cold: 0 });
  });

  test("universal index", () => {
    const u = universalIndex({ 6: { count: 2, sum: 12 }, 20: { count: 1, sum: 10.5 } });
    assert.equal(u.count, 3);
    close(u.index, ((12 - 7) / dieStdDev(6)) / 3);
    assert.deepEqual(universalIndex({}), { count: 0, index: null, z: null });
  });

  test("player record helpers", () => {
    const p = player("a", [20, 5], [{ faces: 6, value: 6 }]);
    addOutcomeToPlayer(p, "criticalSuccess");
    addOutcomeToPlayer(p, "bogus");
    addCharacterToPlayer(p, "Valeros");
    addCharacterToPlayer(p, "Valeros");
    addCharacterToPlayer(p, null);
    assert.deepEqual(p.d20, [20, 5]);
    assert.deepEqual(p.dice[20], { count: 2, sum: 25 });
    assert.deepEqual(p.dice[6], { count: 1, sum: 6 });
    assert.equal(p.outcomes.criticalSuccess, 1);
    assert.equal(p.outcomes.bogus, undefined);
    assert.deepEqual(p.characters, { Valeros: 2 });
  });
});

describe("ranking and minimum-rolls threshold", () => {
  test("players below the threshold are listed but not eligible", () => {
    const row = buildPlayerRow(player("a", [20, 20, 20, 20]), { minRolls: 5 });
    assert.equal(row.eligible, false);
    assert.equal(row.d20.count, 4);
    const row2 = buildPlayerRow(player("a", [20, 20, 20, 20]), { minRolls: 4 });
    assert.equal(row2.eligible, true);
  });

  test("lucky few-roll player cannot win Luckiest", () => {
    const session = {
      id: "s1",
      start: 0,
      end: 3_600_000,
      players: {
        a: player("a", [20, 20, 20]),             // 3 rolls, mean 20 -> not eligible
        b: player("b", [15, 14, 16, 12, 13]),     // mean 14
        c: player("c", [5, 6, 4, 8, 7, 9])        // mean 6.5
      }
    };
    const stats = computeSessionStats(session, { minRolls: 5, d20Only: true });
    assert.equal(stats.rows.length, 3);
    assert.equal(stats.awards.luckiest.rows[0].userId, "b");
    assert.equal(stats.awards.unluckiest.rows[0].userId, "c");
    // Non-threshold awards still consider everyone
    assert.equal(stats.awards.mostNat20.rows[0].userId, "a");
    assert.equal(stats.awards.mostNat20.value, 3);
    // Ineligible player is sorted last and marked
    assert.equal(stats.rows.at(-1).userId, "a");
    assert.equal(stats.rows.at(-1).eligible, false);
  });

  test("unluckiest requires two eligible players", () => {
    const session = { id: "s", start: 0, end: 1, players: { a: player("a", [10, 11, 12, 13, 14]) } };
    const stats = computeSessionStats(session, { minRolls: 5 });
    assert.equal(stats.awards.luckiest.rows[0].userId, "a");
    assert.equal(stats.awards.unluckiest, null);
  });

  test("ties are shared", () => {
    const session = {
      id: "s", start: 0, end: 1,
      players: { a: player("a", [20, 1, 10, 10, 10]), b: player("b", [20, 1, 12, 12, 2]) }
    };
    const stats = computeSessionStats(session, { minRolls: 5 });
    assert.equal(stats.awards.mostNat20.rows.length, 2);
    assert.equal(stats.awards.mostNat1.rows.length, 2);
  });

  test("universal ranking mode uses all dice", () => {
    const session = {
      id: "s", start: 0, end: 1,
      players: {
        a: player("a", [], [6, 6, 6, 6, 6].map((value) => ({ faces: 6, value }))),
        b: player("b", [], [1, 1, 1, 1, 1].map((value) => ({ faces: 6, value })))
      }
    };
    const byD20 = computeSessionStats(session, { minRolls: 5, d20Only: true });
    assert.equal(byD20.awards.luckiest, null);
    const byIndex = computeSessionStats(session, { minRolls: 5, d20Only: false });
    assert.equal(byIndex.awards.luckiest.rows[0].userId, "a");
    assert.equal(byIndex.awards.unluckiest.rows[0].userId, "b");
  });

  test("totals and duration", () => {
    const session = {
      id: "s", start: 1000, end: 1000 + 2 * 3_600_000 + 15 * 60_000,
      counts: { messages: 7 },
      players: { a: player("a", [20, 1]), b: player("b", [10, 11]) }
    };
    const stats = computeSessionStats(session);
    assert.equal(stats.totals.d20Count, 4);
    close(stats.totals.d20Mean, 10.5);
    assert.equal(stats.totals.d20Z, 0);
    assert.equal(stats.totals.messages, 7);
    assert.deepEqual(splitDuration(stats.duration), { hours: 2, minutes: 15, totalMinutes: 135 });
  });

  test("running session uses `now` as end", () => {
    const stats = computeSessionStats({ id: "s", active: true, start: 0, end: null, players: {} }, { now: 90_000 });
    assert.equal(stats.duration, 90_000);
    assert.equal(stats.rows.length, 0);
    assert.equal(stats.totals.d20Mean, null);
  });

  test("expected mean constant", () => {
    assert.equal(D20_MEAN, 10.5);
  });
});
