/**
 * @file Roll collection, session lifecycle and persistence.
 *
 * Only the active GM client records rolls (`game.users.activeGM?.isSelf`), so each
 * message is counted exactly once no matter how many clients are connected.
 * State lives in the world setting `currentSession` and survives reloads.
 *
 * @module session-luck-tracker/tracker
 */

import { MODULE_ID, CHANGE_HOOK, getSetting, log } from "./settings.js";
import {
  OUTCOMES,
  isDieLike,
  extractActiveDice,
  createPlayerRecord,
  addDiceToPlayer,
  addOutcomeToPlayer,
  addCharacterToPlayer,
  computeSessionStats
} from "./stats.js";
import { postStatsMessage, postStartedMessage } from "./chat.js";

/** Version of the stored session schema. */
const SCHEMA_VERSION = 1;

/** Minimum delay between two persisted writes while rolls come in (throttle). */
const SAVE_DELAY_MS = 2500;

/**
 * Identifies this browser tab, so a client can ignore `onChange` echoes of its own writes.
 * Created lazily because `foundry` may not be fully initialised at import time.
 * @type {string|null}
 */
let clientId = null;
const getClientId = () => (clientId ??= foundry.utils.randomID());

/**
 * Return true if `term` is a Foundry Die (d4, d20, d100 ...). Coins and Fate dice are not.
 * @param {any} term
 * @returns {boolean}
 */
function isFoundryDie(term) {
  const DieClass = foundry.dice?.terms?.Die;
  return DieClass ? term instanceof DieClass : isDieLike(term);
}

/**
 * Show a GM-only warning and return false for non-GM callers.
 * @returns {boolean}
 */
function assertGM() {
  if (game.user?.isGM) return true;
  ui.notifications?.warn(game.i18n.localize("SLT.Notify.GMOnly"));
  return false;
}

/**
 * Read the PF2e roll context of a message, if any.
 * @param {ChatMessage} message
 * @returns {{type: string|null, outcome: string|null}|null}
 */
function readPf2eContext(message) {
  if (game.system?.id !== "pf2e") return null;
  try {
    const ctx = message.flags?.pf2e?.context;
    if (!ctx || typeof ctx !== "object") return null;
    return {
      type: typeof ctx.type === "string" ? ctx.type : null,
      outcome: OUTCOMES.includes(ctx.outcome) ? ctx.outcome : null
    };
  } catch {
    return null;
  }
}

/**
 * Heuristic damage/healing roll detection that works across systems.
 * @param {ChatMessage} message
 * @param {Roll} roll
 * @param {{type: string|null}|null} pf2e
 * @returns {boolean}
 */
function isDamageRoll(message, roll, pf2e) {
  const pattern = /damage|healing/i;
  if (pf2e?.type === "damage-roll") return true;
  if (pattern.test(roll?.constructor?.name ?? "")) return true; // DamageRoll (pf2e, dnd5e, ...)
  const optType = roll?.options?.type ?? roll?.options?.rollType;
  if (typeof optType === "string" && pattern.test(optType)) return true;
  const sysFlags = message.flags?.[game.system?.id];
  const sysType = sysFlags?.roll?.type ?? sysFlags?.rollType ?? sysFlags?.context?.type;
  return typeof sysType === "string" && pattern.test(sysType);
}

/**
 * Character name for display (speaker alias or actor name), unless it is just the user name.
 * @param {ChatMessage} message
 * @param {User} author
 * @returns {string|null}
 */
function characterName(message, author) {
  const speaker = message.speaker ?? {};
  const actorName = speaker.actor ? game.actors?.get(speaker.actor)?.name : null;
  const name = String(speaker.alias || actorName || "").trim();
  return name && name !== author.name ? name : null;
}

/**
 * The user's color as a safe CSS hex string.
 * @param {User} user
 * @returns {string|null}
 */
function userColor(user) {
  const c = user?.color;
  const css = typeof c === "string" ? c : (c?.css ?? c?.toString?.());
  return /^#[0-9a-f]{3,8}$/i.test(css ?? "") ? css : null;
}

/**
 * Fill in missing fields of a stored session (forward compatibility).
 * @param {object} raw
 * @returns {object}
 */
function normalizeSession(raw) {
  const s = foundry.utils.deepClone(raw);
  s.version ??= SCHEMA_VERSION;
  s.players ??= {};
  s.counts ??= {};
  s.counts.messages ??= 0;
  s.counts.rolls ??= 0;
  s.counts.dice ??= 0;
  s.counts.skipped = { gm: 0, hidden: 0, damage: 0, flat: 0, ...(s.counts.skipped ?? {}) };
  return s;
}

/**
 * Collects rolls and manages the session lifecycle. Use the exported singleton {@link tracker}.
 */
export class LuckTracker {
  /** @type {object|null} Current session (in memory). */
  #session = null;

  /** @type {Set<string>} Ids of messages already processed in the current session. */
  #counted = new Set();

  /** @type {number|null} */
  #saveTimer = null;

  #dirty = false;

  #rev = 0;

  /** Current session object (do not mutate). */
  get session() {
    return this.#session;
  }

  /** Whether a session is currently being tracked. */
  get isActive() {
    return !!this.#session?.active;
  }

  /** Whether this client is the one that records rolls. */
  get isRecorder() {
    return game.users?.activeGM?.isSelf === true;
  }

  // -------------------------------------------------------------------------
  // Loading & syncing
  // -------------------------------------------------------------------------

  /**
   * Load stored state. Called on `ready`.
   * @returns {boolean} Whether an active session was restored.
   */
  load() {
    this.#adopt(getSetting("currentSession")?.session ?? null);
    return this.isActive;
  }

  /**
   * React to changes of the stored session made by another client (e.g. another GM).
   * @param {{writer?: string, session?: object|null}} value
   */
  onSettingChanged(value) {
    if (value?.writer && value.writer === getClientId()) return; // echo of our own write
    this.#clearTimer();
    this.#dirty = false;
    this.#adopt(value?.session ?? null);
    Hooks.callAll(CHANGE_HOOK, this);
  }

  /** @param {object|null} raw */
  #adopt(raw) {
    if (raw && typeof raw === "object" && raw.id && raw.active) {
      const session = normalizeSession(raw);
      this.#counted = new Set(Array.isArray(session.countedIds) ? session.countedIds : []);
      delete session.countedIds;
      this.#session = session;
    } else {
      this.#session = null;
      this.#counted = new Set();
    }
  }

  // -------------------------------------------------------------------------
  // Roll collection
  // -------------------------------------------------------------------------

  /**
   * `createChatMessage` handler. Never throws.
   * @param {ChatMessage} message
   */
  handleMessage(message) {
    if (!this.#session?.active) return;
    try {
      if (!this.isRecorder) return;
      const rolls = message?.rolls;
      if (!Array.isArray(rolls) || rolls.length === 0) return;
      if (message.flags?.[MODULE_ID]) return; // our own messages
      const id = message.id;
      if (!id || this.#counted.has(id)) return;
      this.#counted.add(id);
      this.#recordMessage(message, rolls);
      this.#scheduleSave();
    } catch (err) {
      log.error("Failed to process chat message", message?.id, err);
    }
  }

  /**
   * Apply filters and record the dice of one message.
   * @param {ChatMessage} message
   * @param {Roll[]} rolls
   * @returns {boolean} Whether anything was recorded.
   */
  #recordMessage(message, rolls) {
    const session = this.#session;
    const counts = session.counts;

    const author = message.author ?? game.users?.get(message._source?.author);
    if (!author) return false;

    if (author.isGM && !getSetting("includeGM")) {
      counts.skipped.gm += 1;
      return false;
    }

    const hidden = !!message.blind || (Array.isArray(message.whisper) && message.whisper.length > 0);
    if (hidden && !getSetting("includeHidden")) {
      counts.skipped.hidden += 1;
      return false;
    }

    const pf2e = readPf2eContext(message);
    if (pf2e?.type === "flat-check" && getSetting("ignoreFlatChecks")) {
      counts.skipped.flat += 1;
      return false;
    }

    const includeDamage = getSetting("includeDamage");
    const dice = [];
    let countedRolls = 0;
    let hasNonDamage = false;

    for (const roll of rolls) {
      try {
        if (!roll) continue;
        const damage = isDamageRoll(message, roll, pf2e);
        if (damage && !includeDamage) {
          counts.skipped.damage += 1;
          continue;
        }
        const found = extractActiveDice(roll, isFoundryDie);
        if (!found.length) continue;
        dice.push(...found);
        countedRolls += 1;
        if (!damage) hasNonDamage = true;
      } catch (err) {
        log.error("Failed to parse roll", roll?.formula, err);
      }
    }
    if (!dice.length) return false;

    const player = (session.players[author.id] ??= createPlayerRecord(author.id, author.name));
    player.name = author.name;
    player.color = userColor(author);
    addCharacterToPlayer(player, characterName(message, author));
    addDiceToPlayer(player, dice);
    if (pf2e?.outcome && hasNonDamage) addOutcomeToPlayer(player, pf2e.outcome);
    player.rolls += countedRolls;
    player.messages += 1;

    counts.messages += 1;
    counts.rolls += countedRolls;
    counts.dice += dice.length;
    return true;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  #clearTimer() {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
  }

  /** Throttled save: at most one write every {@link SAVE_DELAY_MS}. */
  #scheduleSave() {
    this.#dirty = true;
    if (this.#saveTimer) return;
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      if (this.#dirty) this.#saveNow();
    }, SAVE_DELAY_MS);
  }

  /** Persist the current session immediately. */
  async #saveNow() {
    this.#clearTimer();
    this.#dirty = false;
    if (!game.user?.isGM) return;
    const session = this.#session ? { ...this.#session, countedIds: [...this.#counted] } : null;
    this.#rev += 1;
    try {
      await game.settings.set(MODULE_ID, "currentSession", { writer: getClientId(), rev: this.#rev, session });
      Hooks.callAll(CHANGE_HOOK, this);
    } catch (err) {
      log.error("Failed to save session state", err);
    }
  }

  /** Write pending changes now (e.g. before unload). */
  async flush() {
    if (this.#dirty) await this.#saveNow();
  }

  /** @returns {object[]} Archived sessions, most recent first (live reference). */
  #archivedSessions() {
    const sessions = getSetting("history")?.sessions;
    return Array.isArray(sessions) ? sessions : [];
  }

  /** @param {object[]} sessions */
  async #writeArchive(sessions) {
    const size = Math.max(1, Number(getSetting("archiveSize")) || 10);
    await game.settings.set(MODULE_ID, "history", { sessions: sessions.slice(0, size) });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Options passed to {@link computeSessionStats} based on current settings. */
  statsOptions() {
    return {
      minRolls: Number(getSetting("minRolls")) || 0,
      d20Only: getSetting("d20Only") !== false,
      now: Date.now()
    };
  }

  /** @returns {object} A fresh, empty session. */
  #createSession() {
    return {
      version: SCHEMA_VERSION,
      id: foundry.utils.randomID(),
      active: true,
      start: Date.now(),
      end: null,
      world: game.world?.title ?? "",
      system: game.system?.id ?? "",
      players: {},
      counts: { messages: 0, rolls: 0, dice: 0, skipped: { gm: 0, hidden: 0, damage: 0, flat: 0 } }
    };
  }

  /**
   * Start a new tracking session (GM only).
   * @returns {Promise<boolean>} Whether a session was started.
   */
  async start() {
    if (!assertGM()) return false;
    if (this.isActive) {
      ui.notifications.warn(game.i18n.localize("SLT.Notify.AlreadyActive"));
      return false;
    }
    this.#session = this.#createSession();
    this.#counted = new Set();
    await this.#saveNow();
    ui.notifications.info(game.i18n.localize("SLT.Notify.Started"));
    if (getSetting("announceStart")) {
      try { await postStartedMessage(this.#session); } catch (err) { log.error("Failed to post start message", err); }
    }
    Hooks.callAll(CHANGE_HOOK, this);
    return true;
  }

  /**
   * Stop tracking: archive the session, post statistics and clear the current state (GM only).
   * @returns {Promise<import("./stats.js").SessionStats|null>}
   */
  async stop() {
    if (!assertGM()) return null;
    if (!this.isActive) {
      ui.notifications.warn(game.i18n.localize("SLT.Notify.NotActive"));
      return null;
    }
    this.#clearTimer();
    const finished = { ...foundry.utils.deepClone(this.#session), active: false, end: Date.now() };
    this.#session = null;
    this.#counted = new Set();

    let stats = null;
    try {
      stats = computeSessionStats(finished, this.statsOptions());
      await this.#writeArchive([finished, ...this.#archivedSessions()]);
    } catch (err) {
      log.error("Failed to archive session", err);
    }
    await this.#saveNow();

    if (stats) {
      try { await postStatsMessage(stats); } catch (err) {
        log.error("Failed to post statistics", err);
        ui.notifications.error(game.i18n.localize("SLT.Notify.Error"));
      }
    }
    ui.notifications.info(game.i18n.format("SLT.Notify.Stopped", {
      dice: stats?.totals.diceCount ?? 0,
      players: stats?.totals.players ?? 0
    }));
    Hooks.callAll(CHANGE_HOOK, this);
    return stats;
  }

  /**
   * Summary of the current state.
   * @returns {object}
   */
  status() {
    const s = this.#session;
    const stats = s ? computeSessionStats(s, this.statsOptions()) : null;
    return {
      active: this.isActive,
      sessionId: s?.id ?? null,
      startedAt: s?.start ?? null,
      duration: stats?.duration ?? 0,
      players: stats?.totals.players ?? 0,
      messages: s?.counts?.messages ?? 0,
      rolls: s?.counts?.rolls ?? 0,
      dice: s?.counts?.dice ?? 0,
      d20Rolls: stats?.totals.d20Count ?? 0,
      d20Mean: stats?.totals.d20Mean ?? null,
      skipped: foundry.utils.deepClone(s?.counts?.skipped ?? {}),
      recorder: game.users?.activeGM?.name ?? null,
      isRecorder: this.isRecorder,
      archived: this.#archivedSessions().length
    };
  }

  /**
   * Discard the data of the current session (tracking continues with an empty session).
   * @param {object} [options]
   * @param {boolean} [options.history=false]  Also clear the session archive.
   * @returns {Promise<boolean>}
   */
  async reset({ history = false } = {}) {
    if (!assertGM()) return false;
    if (this.isActive) {
      this.#session = this.#createSession();
      this.#counted = new Set();
      await this.#saveNow();
    }
    if (history) await this.#writeArchive([]);
    ui.notifications.info(game.i18n.localize(history ? "SLT.Notify.HistoryCleared" : "SLT.Notify.Reset"));
    Hooks.callAll(CHANGE_HOOK, this);
    return true;
  }

  /**
   * Archived sessions, most recent first (deep copies).
   * @returns {object[]}
   */
  history() {
    if (!game.user?.isGM) return [];
    return foundry.utils.deepClone(this.#archivedSessions());
  }

  /**
   * Find a session by reference.
   * @param {string|number|undefined|null} ref  undefined: current session, else latest archived;
   *   number: index into the archive (0 = latest); string: session id.
   * @returns {{session: object, current: boolean}|null}
   */
  #resolveSession(ref) {
    const archive = this.#archivedSessions();
    if (ref === undefined || ref === null || ref === "") {
      if (this.#session) return { session: this.#session, current: true };
      return archive[0] ? { session: archive[0], current: false } : null;
    }
    if (typeof ref === "number") return archive[ref] ? { session: archive[ref], current: false } : null;
    if (this.#session?.id === ref) return { session: this.#session, current: true };
    const found = archive.find((s) => s.id === ref);
    return found ? { session: found, current: false } : null;
  }

  /**
   * Post statistics to chat without stopping (GM only).
   * @param {string|number} [ref]  Omitted: current session (or latest archived if none is active);
   *   number: archive index (0 = latest); string: session id.
   * @returns {Promise<import("./stats.js").SessionStats|null>}
   */
  async postStats(ref) {
    if (!assertGM()) return null;
    const target = this.#resolveSession(ref);
    if (!target) {
      ui.notifications.warn(game.i18n.localize("SLT.Notify.SessionNotFound"));
      return null;
    }
    try {
      const stats = computeSessionStats(target.session, this.statsOptions());
      await postStatsMessage(stats, { archived: !target.current });
      return stats;
    } catch (err) {
      log.error("Failed to post statistics", err);
      ui.notifications.error(game.i18n.localize("SLT.Notify.Error"));
      return null;
    }
  }

  /**
   * Delete all archived sessions; the current session is not affected (GM only).
   * @returns {Promise<boolean>}
   */
  async clearHistory() {
    if (!assertGM()) return false;
    await this.#writeArchive([]);
    ui.notifications.info(game.i18n.localize("SLT.Notify.HistoryCleared"));
    Hooks.callAll(CHANGE_HOOK, this);
    return true;
  }

  /**
   * Delete one archived session (GM only).
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async deleteSession(id) {
    if (!assertGM()) return false;
    const archive = this.#archivedSessions();
    const next = archive.filter((s) => s.id !== id);
    if (next.length === archive.length) {
      ui.notifications.warn(game.i18n.localize("SLT.Notify.SessionNotFound"));
      return false;
    }
    await this.#writeArchive(next);
    ui.notifications.info(game.i18n.localize("SLT.Notify.SessionDeleted"));
    Hooks.callAll(CHANGE_HOOK, this);
    return true;
  }
}

/** Module-wide tracker singleton. */
export const tracker = new LuckTracker();
