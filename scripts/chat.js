/**
 * @file Chat message rendering for Session Luck Tracker.
 * All visible text goes through `game.i18n`; all dynamic values are HTML-escaped.
 * @module session-luck-tracker/chat
 */

import { MODULE_ID, getSetting } from "./settings.js";
import { D20_MEAN, splitDuration } from "./stats.js";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * Escape a value for safe insertion into HTML.
 * @param {any} value
 * @returns {string}
 */
export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** @returns {string} Current UI language for Intl formatting. */
function locale() {
  return game.i18n?.lang || "en";
}

/** @type {Map<string, Intl.NumberFormat>} */
const formatters = new Map();

/**
 * Locale-aware number formatting. Returns an em dash for missing values.
 * @param {number|null} value
 * @param {number} [digits=2]
 * @param {boolean} [signed=false]  Always show the sign (except for zero).
 * @returns {string}
 */
export function formatNumber(value, digits = 2, signed = false) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const key = `${locale()}|${digits}|${signed}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(locale(), {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        signDisplay: signed ? "exceptZero" : "auto"
      });
    } catch {
      fmt = new Intl.NumberFormat("en", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    formatters.set(key, fmt);
  }
  return fmt.format(value);
}

/**
 * Localized human-readable duration.
 * @param {number} ms
 * @returns {string}
 */
export function formatDurationLabel(ms) {
  const { hours, minutes } = splitDuration(ms);
  if (hours) return game.i18n.format("SLT.Duration.HoursMinutes", { hours, minutes });
  if (minutes) return game.i18n.format("SLT.Duration.Minutes", { minutes });
  return game.i18n.localize("SLT.Duration.LessThanMinute");
}

/**
 * Localized date and time.
 * @param {number|null} timestamp
 * @returns {string}
 */
export function formatDate(timestamp) {
  if (!Number.isFinite(timestamp)) return "—";
  const date = new Date(timestamp);
  try {
    return date.toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return date.toLocaleString();
  }
}

/** @returns {string[]|undefined} Whisper recipients according to the "Post results to" setting. */
function whisperTargets() {
  if (getSetting("postTo") !== "gm") return undefined;
  return game.users.filter((u) => u.isGM).map((u) => u.id);
}

/** @returns {{alias: string}} Message speaker. */
function speaker() {
  return { alias: game.i18n.localize("SLT.Speaker") };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Display label for a player: current user name plus main character.
 * @param {import("./stats.js").PlayerRow} row
 * @returns {string} HTML
 */
function playerLabel(row) {
  const name = escapeHTML(game.users?.get(row.userId)?.name ?? row.name);
  const character = row.characters[0];
  return character
    ? `<span class="slt-name">${name}</span> <span class="slt-char">(${escapeHTML(character)})</span>`
    : `<span class="slt-name">${name}</span>`;
}

/**
 * Small colored dot for a player.
 * @param {import("./stats.js").PlayerRow} row
 * @returns {string} HTML
 */
function colorDot(row) {
  const color = /^#[0-9a-f]{3,8}$/i.test(row.color ?? "") ? row.color : null;
  return color ? `<span class="slt-dot" style="background:${color}"></span>` : `<span class="slt-dot"></span>`;
}

/**
 * CSS class for a value that is above / below expectation.
 * @param {number|null} value
 * @param {number} expected
 * @returns {string}
 */
function trendClass(value, expected) {
  if (value === null || !Number.isFinite(value) || value === expected) return "";
  return value > expected ? "slt-good" : "slt-bad";
}

/**
 * Render one award line.
 * @param {string} icon
 * @param {string} labelKey
 * @param {import("./stats.js").Award|null} award
 * @param {(award: import("./stats.js").Award) => string} describe
 * @param {string} modifier
 * @returns {string} HTML ("" if there is no winner)
 */
function renderAward(icon, labelKey, award, describe, modifier) {
  if (!award) return "";
  const names = award.rows.map(playerLabel).join(", ");
  return `
    <li class="slt-award slt-award--${modifier}">
      <span class="slt-award-icon" aria-hidden="true">${icon}</span>
      <span class="slt-award-body">
        <span class="slt-award-label">${game.i18n.localize(labelKey)}</span>
        <span class="slt-award-winner">${names}</span>
      </span>
      <span class="slt-award-value">${escapeHTML(describe(award))}</span>
    </li>`;
}

/**
 * Render the awards block.
 * @param {import("./stats.js").SessionStats} stats
 * @returns {string} HTML
 */
function renderAwards(stats) {
  const { awards, d20Only } = stats;
  const describeScore = (award) => {
    const row = award.rows[0];
    return d20Only
      ? game.i18n.format("SLT.Awards.MeanValue", { mean: formatNumber(row.d20.mean), z: formatNumber(row.d20.z, 2, true) })
      : game.i18n.format("SLT.Awards.IndexValue", { index: formatNumber(row.universal.index, 2, true) });
  };
  const describeTimes = (award) => game.i18n.format("SLT.Awards.Times", { count: award.value });
  const describeStreak = (award) => game.i18n.format("SLT.Awards.Streak", { count: award.value });

  const items = [
    renderAward("🍀", "SLT.Awards.Luckiest", awards.luckiest, describeScore, "lucky"),
    renderAward("💀", "SLT.Awards.Unluckiest", awards.unluckiest, describeScore, "unlucky"),
    renderAward("🎯", "SLT.Awards.MostNat20", awards.mostNat20, describeTimes, "nat20"),
    renderAward("🪦", "SLT.Awards.MostNat1", awards.mostNat1, describeTimes, "nat1"),
    renderAward("🔥", "SLT.Awards.HotStreak", awards.hotStreak, describeStreak, "hot"),
    renderAward("🧊", "SLT.Awards.ColdStreak", awards.coldStreak, describeStreak, "cold")
  ].join("");
  if (!items.trim()) return `<p class="slt-muted">${game.i18n.format("SLT.Awards.None", { min: stats.minRolls })}</p>`;
  return `<ul class="slt-awards">${items}</ul>`;
}

/**
 * Render the per-player table.
 * @param {import("./stats.js").SessionStats} stats
 * @returns {string} HTML
 */
function renderTable(stats) {
  const L = (k) => game.i18n.localize(k);
  const th = (labelKey, hintKey, cls = "") =>
    `<th class="${cls}" title="${escapeHTML(L(hintKey))}">${escapeHTML(L(labelKey))}</th>`;
  const pf2e = stats.hasOutcomes;

  const head = [
    th("SLT.Table.Player", "SLT.Table.PlayerHint", "slt-col-player"),
    th("SLT.Table.D20", "SLT.Table.D20Hint"),
    th("SLT.Table.Mean", "SLT.Table.MeanHint"),
    th("SLT.Table.Nat20", "SLT.Table.Nat20Hint"),
    th("SLT.Table.Nat1", "SLT.Table.Nat1Hint"),
    th("SLT.Table.Deviation", "SLT.Table.DeviationHint"),
    th("SLT.Table.Index", "SLT.Table.IndexHint"),
    pf2e ? th("SLT.Table.CritSuccess", "SLT.Table.CritSuccessHint") : "",
    pf2e ? th("SLT.Table.CritFailure", "SLT.Table.CritFailureHint") : ""
  ].join("");

  const notEligible = game.i18n.format("SLT.Table.NotEligible", { min: stats.minRolls });
  const body = stats.rows.map((row) => {
    const d = row.d20;
    const zTitle = game.i18n.format("SLT.Table.ZHint", { z: formatNumber(d.z, 2, true) });
    const idxTitle = game.i18n.format("SLT.Table.IndexDetail", {
      count: row.universal.count,
      z: formatNumber(row.universal.z, 2, true)
    });
    const marker = row.eligible ? "" : `<span class="slt-marker" title="${escapeHTML(notEligible)}">*</span>`;
    return `
      <tr class="${row.eligible ? "" : "slt-ineligible"}">
        <td class="slt-col-player">${colorDot(row)}${playerLabel(row)}${marker}</td>
        <td>${d.count}</td>
        <td class="${trendClass(d.mean, D20_MEAN)}" title="${escapeHTML(zTitle)}">${formatNumber(d.mean)}</td>
        <td class="${d.nat20 ? "slt-good" : ""}">${d.nat20}</td>
        <td class="${d.nat1 ? "slt-bad" : ""}">${d.nat1}</td>
        <td class="${trendClass(d.deviationSum, 0)}">${d.count ? formatNumber(d.deviationSum, 1, true) : "—"}</td>
        <td class="${trendClass(row.universal.index, 0)}" title="${escapeHTML(idxTitle)}">${formatNumber(row.universal.index, 2, true)}</td>
        ${pf2e ? `<td>${row.outcomes.criticalSuccess}</td><td>${row.outcomes.criticalFailure}</td>` : ""}
      </tr>`;
  }).join("");

  const footnote = stats.rows.some((r) => !r.eligible) ? `<p class="slt-footnote">${escapeHTML(notEligible)}</p>` : "";
  return `
    <div class="slt-table-wrap">
      <table class="slt-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>${footnote}`;
}

/**
 * Render the overall summary.
 * @param {import("./stats.js").SessionStats} stats
 * @returns {string} HTML
 */
function renderSummary(stats) {
  const t = stats.totals;
  const lines = [
    game.i18n.format("SLT.Summary.Dice", { dice: t.diceCount, messages: t.messages }),
    game.i18n.format("SLT.Summary.D20", {
      count: t.d20Count,
      mean: formatNumber(t.d20Mean),
      expected: formatNumber(D20_MEAN, 1),
      z: formatNumber(t.d20Z, 2, true)
    }),
    game.i18n.format("SLT.Summary.Nats", { nat20: t.nat20, nat1: t.nat1 })
  ];
  if (stats.hasOutcomes) {
    lines.push(game.i18n.format("SLT.Summary.Outcomes", {
      cs: t.outcomes.criticalSuccess,
      s: t.outcomes.success,
      f: t.outcomes.failure,
      cf: t.outcomes.criticalFailure
    }));
  }
  lines.push(game.i18n.localize(stats.d20Only ? "SLT.Summary.RankingD20" : "SLT.Summary.RankingIndex"));
  return `<footer class="slt-summary">${lines.map((l) => `<div>${escapeHTML(l)}</div>`).join("")}</footer>`;
}

/**
 * Render the full statistics card.
 * @param {import("./stats.js").SessionStats} stats
 * @param {object} [options]
 * @param {boolean} [options.archived=false]  The session comes from the archive.
 * @returns {string} HTML
 */
export function renderStatsHTML(stats, { archived = false } = {}) {
  let titleKey = "SLT.Chat.ReportTitle";
  if (stats.active) titleKey = "SLT.Chat.InterimTitle";
  else if (archived) titleKey = "SLT.Chat.ArchivedTitle";

  const meta = game.i18n.format("SLT.Chat.Meta", {
    world: stats.world || game.world?.title || "",
    date: formatDate(stats.start)
  });
  const duration = game.i18n.format("SLT.Chat.Duration", { duration: formatDurationLabel(stats.duration) });

  const header = `
    <header class="slt-header">
      <span class="slt-header-icon" aria-hidden="true">🎲</span>
      <div class="slt-header-text">
        <h3 class="slt-title">${escapeHTML(game.i18n.localize(titleKey))}</h3>
        <div class="slt-meta">${escapeHTML(meta)}</div>
        <div class="slt-meta">${escapeHTML(duration)}</div>
      </div>
    </header>`;

  if (!stats.rows.length) {
    return `<div class="slt-card">${header}<p class="slt-muted">${escapeHTML(game.i18n.localize("SLT.Chat.NoRolls"))}</p></div>`;
  }
  return `<div class="slt-card">${header}${renderAwards(stats)}${renderTable(stats)}${renderSummary(stats)}</div>`;
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

/**
 * Post the statistics card to chat.
 * @param {import("./stats.js").SessionStats} stats
 * @param {object} [options]  See {@link renderStatsHTML}.
 * @returns {Promise<ChatMessage|undefined>}
 */
export async function postStatsMessage(stats, options = {}) {
  return ChatMessage.create({
    content: renderStatsHTML(stats, options),
    speaker: speaker(),
    whisper: whisperTargets(),
    flags: { [MODULE_ID]: { kind: "report", sessionId: stats.sessionId } }
  });
}

/**
 * Post the short "tracking started" announcement.
 * @param {object} session
 * @returns {Promise<ChatMessage|undefined>}
 */
export async function postStartedMessage(session) {
  const content = `
    <div class="slt-card slt-card--compact">
      <header class="slt-header">
        <span class="slt-header-icon" aria-hidden="true">🍀</span>
        <div class="slt-header-text">
          <h3 class="slt-title">${escapeHTML(game.i18n.localize("SLT.Chat.StartedTitle"))}</h3>
          <div class="slt-meta">${escapeHTML(game.i18n.localize("SLT.Chat.StartedBody"))}</div>
        </div>
      </header>
    </div>`;
  return ChatMessage.create({
    content,
    speaker: speaker(),
    whisper: whisperTargets(),
    flags: { [MODULE_ID]: { kind: "started", sessionId: session.id } }
  });
}
