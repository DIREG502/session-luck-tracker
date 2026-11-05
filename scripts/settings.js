/**
 * @file Module constants, logging helpers and settings registration.
 * @module session-luck-tracker/settings
 */

/** Module id as declared in module.json. */
export const MODULE_ID = "session-luck-tracker";

/** Custom hook fired (via Hooks.callAll) whenever tracker state or the archive changes. */
export const CHANGE_HOOK = "sessionLuckTrackerChanged";

/** Console prefix for every log line of this module. */
export const LOG_PREFIX = "[SLT]";

/** Thin console wrapper that always prefixes messages with {@link LOG_PREFIX}. */
export const log = Object.freeze({
  /** @param {...any} args */
  info: (...args) => console.info(LOG_PREFIX, ...args),
  /** @param {...any} args */
  warn: (...args) => console.warn(LOG_PREFIX, ...args),
  /** @param {...any} args */
  error: (...args) => console.error(LOG_PREFIX, ...args)
});

/**
 * Fallback values used if a setting cannot be read (e.g. before `init` finished).
 * @type {Readonly<Record<string, any>>}
 */
const DEFAULTS = Object.freeze({
  includeGM: false,
  includeHidden: true,
  includeDamage: false,
  ignoreFlatChecks: false,
  announceStart: true,
  minRolls: 5,
  d20Only: true,
  postTo: "everyone",
  archiveSize: 10,
  currentSession: { session: null },
  history: { sessions: [] }
});

/**
 * Register all module settings. Called once from the `init` hook.
 * Callbacks are injected to avoid circular imports with the tracker.
 *
 * @param {object} [hooks]
 * @param {(value: object) => void} [hooks.onSessionChange]  Called when the stored session changes.
 * @param {() => void} [hooks.onHistoryChange]               Called when the archive changes.
 * @param {Function} [hooks.menuType]                        Application class for the settings menu.
 */
export function registerSettings({ onSessionChange, onHistoryChange, menuType } = {}) {
  const register = (key, data) => game.settings.register(MODULE_ID, key, { scope: "world", ...data });

  if (menuType) {
    game.settings.registerMenu(MODULE_ID, "sessionsMenu", {
      name: "SLT.Menu.Name",
      label: "SLT.Menu.Label",
      hint: "SLT.Menu.Hint",
      icon: "fa-solid fa-clover",
      type: menuType,
      restricted: true
    });
  }

  register("includeGM", {
    name: "SLT.Settings.IncludeGM.Name",
    hint: "SLT.Settings.IncludeGM.Hint",
    config: true,
    type: Boolean,
    default: DEFAULTS.includeGM
  });

  register("includeHidden", {
    name: "SLT.Settings.IncludeHidden.Name",
    hint: "SLT.Settings.IncludeHidden.Hint",
    config: true,
    type: Boolean,
    default: DEFAULTS.includeHidden
  });

  register("includeDamage", {
    name: "SLT.Settings.IncludeDamage.Name",
    hint: "SLT.Settings.IncludeDamage.Hint",
    config: true,
    type: Boolean,
    default: DEFAULTS.includeDamage
  });

  register("ignoreFlatChecks", {
    name: "SLT.Settings.IgnoreFlatChecks.Name",
    hint: "SLT.Settings.IgnoreFlatChecks.Hint",
    config: true,
    type: Boolean,
    default: DEFAULTS.ignoreFlatChecks
  });

  register("d20Only", {
    name: "SLT.Settings.D20Only.Name",
    hint: "SLT.Settings.D20Only.Hint",
    config: true,
    type: Boolean,
    default: DEFAULTS.d20Only
  });

  register("minRolls", {
    name: "SLT.Settings.MinRolls.Name",
    hint: "SLT.Settings.MinRolls.Hint",
    config: true,
    type: Number,
    range: { min: 1, max: 100, step: 1 },
    default: DEFAULTS.minRolls
  });

  register("postTo", {
    name: "SLT.Settings.PostTo.Name",
    hint: "SLT.Settings.PostTo.Hint",
    config: true,
    type: String,
    choices: {
      everyone: "SLT.Settings.PostTo.Everyone",
      gm: "SLT.Settings.PostTo.GM"
    },
    default: DEFAULTS.postTo
  });

  register("announceStart", {
    name: "SLT.Settings.AnnounceStart.Name",
    hint: "SLT.Settings.AnnounceStart.Hint",
    config: true,
    type: Boolean,
    default: DEFAULTS.announceStart
  });

  register("archiveSize", {
    name: "SLT.Settings.ArchiveSize.Name",
    hint: "SLT.Settings.ArchiveSize.Hint",
    config: true,
    type: Number,
    range: { min: 1, max: 50, step: 1 },
    default: DEFAULTS.archiveSize
  });

  // --- Hidden storage -------------------------------------------------------

  register("currentSession", {
    config: false,
    type: Object,
    default: DEFAULTS.currentSession,
    onChange: (value) => {
      try { onSessionChange?.(value); } catch (err) { log.error("currentSession onChange failed", err); }
    }
  });

  register("history", {
    config: false,
    type: Object,
    default: DEFAULTS.history,
    onChange: () => {
      try { onHistoryChange?.(); } catch (err) { log.error("history onChange failed", err); }
    }
  });
}

/**
 * Read a module setting, falling back to the default on failure.
 * @param {string} key
 * @returns {any}
 */
export function getSetting(key) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch (err) {
    log.warn(`Could not read setting "${key}", using default.`, err);
    return foundry.utils.deepClone(DEFAULTS[key]);
  }
}
