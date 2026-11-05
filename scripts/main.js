/**
 * @file Entry point: hooks, scene control buttons and the public API.
 *
 * API (GM only, except `status`):
 *   const slt = game.modules.get("session-luck-tracker").api;
 *   await slt.start(); await slt.stop(); slt.status(); await slt.reset();
 *   await slt.postStats(); slt.history(); slt.openSessions();
 *
 * @module session-luck-tracker/main
 */

import { MODULE_ID, CHANGE_HOOK, registerSettings, log } from "./settings.js";
import { tracker } from "./tracker.js";
import { SessionHistoryApp, confirmDialog } from "./history-app.js";

const TOOL_TOGGLE = "slt-toggle";
const TOOL_SESSIONS = "slt-sessions";

/** Last tracking state the scene controls were rendered with. */
let controlsActiveState = null;

// ---------------------------------------------------------------------------
// Scene controls
// ---------------------------------------------------------------------------

/** Re-render scene controls so the toggle reflects the tracker state. */
function refreshSceneControls() {
  try {
    if (!ui.controls?.rendered) return;
    if ((game.release?.generation ?? 12) >= 13) ui.controls.render({ reset: true });
    else ui.controls.initialize();
  } catch (err) {
    log.error("Failed to refresh scene controls", err);
  }
}

/**
 * Handle a click on the toggle tool. Stopping asks for confirmation.
 * @param {boolean} active  Requested state.
 */
async function onToggle(active) {
  try {
    if (active) await tracker.start();
    else if (await confirmDialog("SLT.History.ConfirmStopTitle", "SLT.History.ConfirmStopBody")) await tracker.stop();
  } catch (err) {
    log.error("Toggle failed", err);
  }
  // Re-sync the button if the action was refused or cancelled.
  if (tracker.isActive !== active) refreshSceneControls();
}

/**
 * `getSceneControlButtons` handler. Supports v13 (object of controls) and v12 (array).
 * @param {Record<string, object>|object[]} controls
 */
function onGetSceneControlButtons(controls) {
  if (!game.user?.isGM) return;
  try {
    const toggleTitle = game.i18n.localize("SLT.Controls.Toggle");
    const sessionsTitle = game.i18n.localize("SLT.Controls.Sessions");
    const toggleIcon = "fa-solid fa-clover";
    const sessionsIcon = "fa-solid fa-chart-simple";
    controlsActiveState = tracker.isActive;

    if (!Array.isArray(controls)) {
      // v13: controls and tools are records keyed by name; tools use onChange.
      const group = controls.tokens ?? controls.token ?? Object.values(controls)[0];
      if (!group?.tools) return;
      const order = Object.keys(group.tools).length;
      group.tools[TOOL_TOGGLE] = {
        name: TOOL_TOGGLE,
        order,
        title: toggleTitle,
        icon: toggleIcon,
        toggle: true,
        active: tracker.isActive,
        visible: true,
        onChange: (event, active) => onToggle(!!active)
      };
      group.tools[TOOL_SESSIONS] = {
        name: TOOL_SESSIONS,
        order: order + 1,
        title: sessionsTitle,
        icon: sessionsIcon,
        button: true,
        visible: true,
        onChange: () => SessionHistoryApp.open()
      };
    } else {
      // v12: arrays; tools use onClick.
      const group = controls.find((c) => c.name === "token") ?? controls[0];
      if (!Array.isArray(group?.tools)) return;
      group.tools.push(
        {
          name: TOOL_TOGGLE,
          title: toggleTitle,
          icon: toggleIcon,
          toggle: true,
          active: tracker.isActive,
          visible: true,
          onClick: (toggled) => onToggle(!!toggled)
        },
        {
          name: TOOL_SESSIONS,
          title: sessionsTitle,
          icon: sessionsIcon,
          button: true,
          visible: true,
          onClick: () => SessionHistoryApp.open()
        }
      );
    }
  } catch (err) {
    log.error("Failed to add scene control buttons", err);
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

Hooks.once("init", () => {
  registerSettings({
    onSessionChange: (value) => tracker.onSettingChanged(value),
    onHistoryChange: () => Hooks.callAll(CHANGE_HOOK, tracker),
    menuType: SessionHistoryApp
  });

  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = Object.freeze({
      /** Start a new session (GM). @returns {Promise<boolean>} */
      start: () => tracker.start(),
      /** Stop, archive and post results (GM). @returns {Promise<object|null>} statistics */
      stop: () => tracker.stop(),
      /** Current state summary. @returns {object} */
      status: () => tracker.status(),
      /** Clear the current session's data; `{history: true}` also clears the archive (GM). */
      reset: (options) => tracker.reset(options),
      /** Post stats: no argument = current (or latest archived), number = archive index, string = session id (GM). */
      postStats: (ref) => tracker.postStats(ref),
      /** Archived sessions, most recent first (GM). @returns {object[]} */
      history: () => tracker.history(),
      /** Delete one archived session by id (GM). */
      deleteSession: (id) => tracker.deleteSession(id),
      /** Delete all archived sessions (GM). */
      clearHistory: () => tracker.clearHistory(),
      /** Open the sessions window. */
      openSessions: () => SessionHistoryApp.open()
    });
  }
});

Hooks.once("ready", () => {
  try {
    const resumed = tracker.load();
    if (resumed && game.user?.isGM) ui.notifications.info(game.i18n.localize("SLT.Notify.Resumed"));
    if (game.user?.isGM) refreshSceneControls();
  } catch (err) {
    log.error("Failed to restore session state", err);
  }
  // Best effort: persist pending rolls when the GM closes or reloads the page.
  window.addEventListener("beforeunload", () => { tracker.flush(); });
});

Hooks.on("createChatMessage", (message) => tracker.handleMessage(message));

Hooks.on("getSceneControlButtons", onGetSceneControlButtons);

Hooks.on(CHANGE_HOOK, () => {
  if (!game.user?.isGM) return;
  if (controlsActiveState !== null && controlsActiveState !== tracker.isActive) refreshSceneControls();
});
