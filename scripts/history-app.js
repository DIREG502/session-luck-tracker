/**
 * @file ApplicationV2 window to control tracking and manage the session archive.
 * Rendered without Handlebars templates: `_renderHTML` builds an HTML string.
 * @module session-luck-tracker/history-app
 */

import { CHANGE_HOOK, getSetting, log } from "./settings.js";
import { tracker } from "./tracker.js";
import { computeSessionStats } from "./stats.js";
import { escapeHTML, formatDate, formatDurationLabel, formatNumber } from "./chat.js";

const { ApplicationV2, DialogV2 } = foundry.applications.api;

/**
 * Ask for confirmation with a DialogV2.
 * @param {string} titleKey
 * @param {string} bodyKey
 * @param {object} [data]  Format data (values are escaped).
 * @returns {Promise<boolean>}
 */
export async function confirmDialog(titleKey, bodyKey, data = {}) {
  const safe = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, escapeHTML(v)]));
  try {
    const result = await DialogV2.confirm({
      window: { title: game.i18n.localize(titleKey) },
      content: `<p>${game.i18n.format(bodyKey, safe)}</p>`,
      rejectClose: false,
      modal: true
    });
    return result === true;
  } catch (err) {
    log.error("Confirmation dialog failed", err);
    return false;
  }
}

/**
 * Short summary of a stored session for list display.
 * @param {object} session
 * @returns {object}
 */
function summarize(session) {
  const stats = computeSessionStats(session, tracker.statsOptions());
  const lucky = stats.awards.luckiest?.rows.map((r) => r.name).join(", ") ?? null;
  return {
    id: session.id,
    start: stats.start,
    duration: stats.duration,
    players: stats.totals.players,
    d20: stats.totals.d20Count,
    mean: stats.totals.d20Mean,
    lucky
  };
}

/**
 * Sessions window: current session controls and the archive.
 */
export class SessionHistoryApp extends ApplicationV2 {
  /** @type {number|null} */
  #hookId = null;

  static DEFAULT_OPTIONS = {
    classes: ["slt-app"],
    tag: "section",
    window: {
      title: "SLT.History.Title",
      icon: "fa-solid fa-clover",
      resizable: true
    },
    position: { width: 540, height: "auto" },
    actions: {
      start: SessionHistoryApp.#onStart,
      stop: SessionHistoryApp.#onStop,
      postCurrent: SessionHistoryApp.#onPostCurrent,
      reset: SessionHistoryApp.#onReset,
      post: SessionHistoryApp.#onPost,
      delete: SessionHistoryApp.#onDelete,
      clearHistory: SessionHistoryApp.#onClearHistory
    }
  };

  /**
   * Open (or bring to front) the single sessions window.
   * @returns {SessionHistoryApp}
   */
  static open() {
    let app = null;
    for (const instance of foundry.applications.instances?.values?.() ?? []) {
      if (instance instanceof SessionHistoryApp) { app = instance; break; }
    }
    app ??= new SessionHistoryApp();
    app.render({ force: true });
    return app;
  }

  /** @override */
  get title() {
    return game.i18n.localize("SLT.History.Title");
  }

  /** @override */
  async _prepareContext(options) {
    const isGM = !!game.user?.isGM;
    const current = tracker.session ? summarize(tracker.session) : null;
    const sessions = isGM ? tracker.history().map(summarize) : [];
    return { isGM, current, sessions, max: Number(getSetting("archiveSize")) || 10 };
  }

  /** @override */
  async _renderHTML(context, options) {
    const L = (k) => escapeHTML(game.i18n.localize(k));
    const F = (k, d) => escapeHTML(game.i18n.format(k, d));
    if (!context.isGM) return `<p class="slt-muted">${L("SLT.History.GMOnly")}</p>`;

    const button = (action, icon, labelKey, extra = "", cls = "") =>
      `<button type="button" class="slt-btn ${cls}" data-action="${action}" ${extra}><i class="${icon}"></i> ${L(labelKey)}</button>`;

    const c = context.current;
    const current = c
      ? `<p class="slt-app-status slt-app-status--on"><i class="fa-solid fa-circle"></i> ${F("SLT.History.CurrentMeta", {
          date: formatDate(c.start),
          duration: formatDurationLabel(c.duration),
          players: c.players,
          d20: c.d20,
          mean: formatNumber(c.mean)
        })}</p>
        <div class="slt-app-buttons">
          ${button("postCurrent", "fa-solid fa-comment", "SLT.History.PostInterim")}
          ${button("reset", "fa-solid fa-rotate-left", "SLT.History.Reset")}
          ${button("stop", "fa-solid fa-stop", "SLT.History.Stop", "", "slt-btn--primary")}
        </div>`
      : `<p class="slt-app-status"><i class="fa-regular fa-circle"></i> ${L("SLT.History.NoCurrent")}</p>
        <div class="slt-app-buttons">${button("start", "fa-solid fa-play", "SLT.History.Start", "", "slt-btn--primary")}</div>`;

    const items = context.sessions.map((s) => `
      <li class="slt-app-item">
        <div class="slt-app-item-meta">
          <strong>${escapeHTML(formatDate(s.start))}</strong>
          <span>${F("SLT.History.ItemMeta", {
            duration: formatDurationLabel(s.duration),
            players: s.players,
            d20: s.d20,
            mean: formatNumber(s.mean)
          })}</span>
          ${s.lucky ? `<span>🍀 ${escapeHTML(s.lucky)}</span>` : ""}
        </div>
        <div class="slt-app-buttons">
          ${button("post", "fa-solid fa-comment", "SLT.History.Post", `data-session-id="${escapeHTML(s.id)}"`)}
          ${button("delete", "fa-solid fa-trash", "SLT.History.Delete", `data-session-id="${escapeHTML(s.id)}" data-date="${escapeHTML(formatDate(s.start))}"`)}
        </div>
      </li>`).join("");

    const archive = context.sessions.length
      ? `<ol class="slt-app-list">${items}</ol>`
      : `<p class="slt-muted">${L("SLT.History.Empty")}</p>`;

    return `
      <section class="slt-app-section">
        <h3>${L("SLT.History.Current")}</h3>
        ${current}
      </section>
      <section class="slt-app-section">
        <div class="slt-app-section-head">
          <h3>${F("SLT.History.Archive", { count: context.sessions.length, max: context.max })}</h3>
          ${context.sessions.length ? button("clearHistory", "fa-solid fa-broom", "SLT.History.ClearAll") : ""}
        </div>
        ${archive}
      </section>`;
  }

  /** @override */
  _replaceHTML(result, content, options) {
    content.innerHTML = result;
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender?.(context, options);
    this.#hookId = Hooks.on(CHANGE_HOOK, () => {
      if (this.rendered) this.render();
    });
  }

  /** @override */
  _onClose(options) {
    super._onClose?.(options);
    if (this.#hookId !== null) Hooks.off(CHANGE_HOOK, this.#hookId);
    this.#hookId = null;
  }

  // -------------------------------------------------------------------------
  // Actions (`this` is the application instance)
  // -------------------------------------------------------------------------

  static async #onStart() {
    await tracker.start();
  }

  static async #onStop() {
    if (await confirmDialog("SLT.History.ConfirmStopTitle", "SLT.History.ConfirmStopBody")) await tracker.stop();
  }

  static async #onPostCurrent() {
    await tracker.postStats();
  }

  static async #onReset() {
    if (await confirmDialog("SLT.History.ConfirmResetTitle", "SLT.History.ConfirmResetBody")) await tracker.reset();
  }

  static async #onPost(event, target) {
    await tracker.postStats(target.dataset.sessionId);
  }

  static async #onDelete(event, target) {
    const ok = await confirmDialog("SLT.History.ConfirmDeleteTitle", "SLT.History.ConfirmDeleteBody", {
      date: target.dataset.date ?? ""
    });
    if (ok) await tracker.deleteSession(target.dataset.sessionId);
  }

  static async #onClearHistory() {
    if (await confirmDialog("SLT.History.ConfirmClearTitle", "SLT.History.ConfirmClearBody")) {
      await tracker.clearHistory();
    }
  }
}
