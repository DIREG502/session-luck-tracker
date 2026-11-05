# Session Luck Tracker

*[English](#english) · [Русский](#русский)*

---

## English

A Foundry VTT module that counts every dice roll players make during a game session.
The GM starts tracking at the beginning of the session and stops it at the end; the module then
posts a chat report with the luckiest and unluckiest players, natural 20s / 1s, streaks and a
per-player table.

- Foundry VTT **v12 – v13** (verified 13), ApplicationV2, no deprecated APIs.
- Works with **any system**. With **Pathfinder 2e**, degrees of success (critical successes /
  failures) are added, and damage rolls and flat checks are recognised.
- No dependencies, no network requests.
- Languages: English, Русский, Deutsch.

### Installation

1. Copy the `session-luck-tracker` folder to `{userData}/Data/modules/`
   (or zip it and install it via a manifest URL of your own hosting).
2. Restart Foundry, open your world, and enable **Session Luck Tracker** in *Manage Modules*.

`package.json` and `tests/` are only needed for development. You can leave them out of a release.

### Usage

| Where | What |
|---|---|
| Scene controls → Token tools → 🍀 (toggle) | Start / stop tracking (stopping asks for confirmation) |
| Scene controls → Token tools → 📊 | Sessions window: status, interim stats, reset, archive |
| Settings → Session Luck Tracker → *Sessions and archive* | Same window |

1. At the start of the game, the GM clicks 🍀. A notification and (optionally) a short chat
   announcement appear.
2. Players roll as usual. Only the **active GM** client records rolls, so every message is counted
   exactly once.
3. At the end, the GM clicks 🍀 again → the session is archived and the report is posted.

The session survives page reloads: state is stored in a world setting (writes are throttled to
at most one every 2.5 s) and tracking resumes automatically.

### Luck metrics

- **Mean d20** of all *active* d20 results (dice dropped by `kh`/`kl`/rerolls are ignored).
  Expected value: 10.5.
- **Δ** is the total deviation `Σ(result − 10.5)`.
- **z-score**: `z = (mean − 10.5) / (5.766 / √n)`. Hover the average in the table to see it.
- **Universal index (Idx)** is the mean of `(result − (faces+1)/2) / √((faces²−1)/12)` over *all*
  dice (d4…d100, including d20). 0 is average and ±1 is one standard deviation per die.
- Players with fewer rolls than *Minimum rolls for awards* stay in the table (marked `*`) but
  cannot win Luckiest / Unluckiest.

Awards: 🍀 Luckiest, 💀 Unluckiest, 🎯 Most natural 20s, 🪦 Most natural 1s,
🔥 longest streak of d20 ≥ 11, 🧊 longest streak of d20 ≤ 10 (streaks need at least 3).

### Macro API

```js
const slt = game.modules.get("session-luck-tracker").api;

await slt.start();          // start a new session (GM)
await slt.stop();           // stop, archive, post report; returns the statistics object
slt.status();               // { active, sessionId, startedAt, players, d20Rolls, dice, ... }
await slt.reset();          // discard data of the current session, keep tracking
await slt.reset({ history: true }); // ...and also clear the archive
await slt.postStats();      // post interim stats (or the latest archived session if none is active)
await slt.postStats(0);     // re-post archived session by index (0 = latest)
await slt.postStats("id");  // re-post archived session by id
slt.history();              // array of archived sessions (most recent first)
await slt.deleteSession("id");
await slt.clearHistory();
slt.openSessions();         // open the sessions window
```

All calls except `status()` are GM-only. Non-GM callers get a warning, and the server rejects
non-GM writes to world settings anyway.

The module also fires the hook `sessionLuckTrackerChanged` (argument: tracker) when the state
or the archive changes.

### Settings

| Setting | Default | Description |
|---|---|---|
| Include GM rolls | off | Also count GM users' rolls |
| Include hidden and blind rolls | on | Count private / GM-only / self / blind rolls |
| Include damage rolls | off | Count damage & healing dice |
| Ignore flat checks (PF2e) | off | Skip PF2e flat checks |
| Rank by d20 only | on | Rank by mean d20; off = universal index over all dice |
| Minimum rolls for awards | 5 | Eligibility threshold for Luckiest / Unluckiest |
| Post results to | Everyone | Everyone (public) or GM only (whisper) |
| Announce session start in chat | on | Short "tracking started" message |
| Session archive size | 10 | Number of finished sessions kept |

### Development

```bash
npm test            # or: node --test tests/
```

`scripts/stats.js` contains only pure functions and is tested without Foundry.

### Manual test checklist

1. **Plain d20**: as a player, `/r 1d20`. After 3 s, `api.status().d20Rolls` on the GM is +1.
2. **Advantage**: `/r 2d20kh`. Only the kept die is counted (`d20Rolls` +1, not +2).
3. **Damage**: `/r 2d6` with a damage roll (PF2e Strike damage). Not counted by default. With
   *Include damage rolls* on, it raises the dice count and the Idx column.
4. **Hidden roll**: set roll mode to *Blind GM Roll* and roll. It is counted while
   *Include hidden and blind rolls* is on and skipped (`status().skipped.hidden`) while it is off.
5. **Reload**: start a session, make rolls, press F5 on the GM. "Tracking resumed" is shown, the
   counts are kept, and new rolls are added.
6. **Stop**: the report is posted. In the *Sessions* window, the archived session can be posted again.

---

## Русский

Модуль Foundry VTT, который считает все броски кубиков игроков за игровую сессию.
ГМ включает учёт в начале сессии и выключает в конце. После этого модуль публикует в чат отчёт:
самый удачливый и самый невезучий игрок, натуральные 20 и 1, серии и таблица по игрокам.

- Foundry VTT **v12 – v13** (проверено на 13), ApplicationV2, без устаревших API.
- Работает с **любой системой**. Для **Pathfinder 2e** дополнительно учитываются степени успеха
  (крит. успехи и провалы), а броски урона и чистые проверки распознаются автоматически.
- Без зависимостей и сетевых запросов.
- Языки: English, Русский, Deutsch.

### Установка

1. Скопируйте папку `session-luck-tracker` в `{userData}/Data/modules/`.
2. Перезапустите Foundry, откройте мир и включите **Session Luck Tracker** в *Управлении модулями*.

`package.json` и `tests/` нужны только для разработки, в релиз их можно не включать.

### Использование

| Где | Что |
|---|---|
| Панель сцены → инструменты токенов → 🍀 (переключатель) | Старт / стоп учёта (остановка требует подтверждения) |
| Панель сцены → инструменты токенов → 📊 | Окно сессий: статус, промежуточная статистика, сброс, архив |
| Настройки → Session Luck Tracker → *Сессии и архив* | То же окно |

1. В начале игры ГМ нажимает 🍀. Появляется уведомление и, если включено, короткое сообщение в чате.
2. Игроки бросают кубы как обычно. Броски записывает только клиент **активного ГМ**, поэтому каждое
   сообщение учитывается ровно один раз.
3. В конце ГМ снова нажимает 🍀. Сессия уходит в архив, а отчёт публикуется в чат.

Сессия переживает перезагрузку страницы. Состояние хранится в настройке мира (запись не чаще
раза в 2,5 с), и после перезагрузки учёт продолжается автоматически.

### Метрики удачи

- **Среднее d20** считается по всем *активным* результатам d20. Кубы, отброшенные `kh`/`kl` или
  переброшенные, не считаются. Ожидаемое значение — 10,5.
- **Δ** — суммарное отклонение `Σ(результат − 10,5)`.
- **z-оценка**: `z = (среднее − 10,5) / (5,766 / √n)`. Видна при наведении на среднее в таблице.
- **Универсальный индекс (Инд.)** — среднее значение `(результат − (грани+1)/2) / √((грани²−1)/12)`
  по *всем* кубам (d4…d100, включая d20). 0 — норма, ±1 — одно стандартное отклонение на куб.
- Игроки, у которых бросков меньше порога *Минимум бросков для наград*, остаются в таблице
  (с пометкой `*`), но не участвуют в номинациях «Самый удачливый / невезучий».

Награды: 🍀 Самый удачливый, 💀 Самый невезучий, 🎯 Больше всего натуральных 20,
🪦 Больше всего натуральных 1, 🔥 самая длинная серия d20 ≥ 11, 🧊 самая длинная серия d20 ≤ 10
(серия засчитывается от 3 бросков).

### API для макросов

```js
const slt = game.modules.get("session-luck-tracker").api;

await slt.start();          // начать новую сессию (ГМ)
await slt.stop();           // остановить, архивировать, опубликовать отчёт; возвращает статистику
slt.status();               // { active, sessionId, startedAt, players, d20Rolls, dice, ... }
await slt.reset();          // сбросить данные текущей сессии, учёт продолжается
await slt.reset({ history: true }); // ...и заодно очистить архив
await slt.postStats();      // промежуточная статистика (или последняя архивная, если учёт не идёт)
await slt.postStats(0);     // повторно опубликовать архивную сессию по индексу (0 = последняя)
await slt.postStats("id");  // ...или по id
slt.history();              // массив архивных сессий (новые первыми)
await slt.deleteSession("id");
await slt.clearHistory();
slt.openSessions();         // открыть окно сессий
```

Все вызовы, кроме `status()`, доступны только ГМ. Для остальных выводится предупреждение,
а запись в настройки мира не от ГМ отклоняет сервер.

При изменении состояния или архива вызывается хук `sessionLuckTrackerChanged`.

### Настройки

| Настройка | По умолчанию | Описание |
|---|---|---|
| Учитывать броски ГМ | выкл. | Считать также броски ГМ |
| Учитывать скрытые и слепые броски | вкл. | Приватные, только для ГМ, «для себя», слепые |
| Учитывать броски урона | выкл. | Кубы урона и лечения |
| Игнорировать чистые проверки (PF2e) | выкл. | Пропускать flat checks PF2e |
| Рейтинг только по d20 | вкл. | Рейтинг по среднему d20; если выключено — универсальный индекс |
| Минимум бросков для наград | 5 | Порог для номинаций «удачливый / невезучий» |
| Кому отправлять итоги | Всем | Всем (публично) или только ГМ (шёпотом) |
| Объявлять начало сессии в чате | вкл. | Короткое сообщение «учёт начат» |
| Размер архива сессий | 10 | Сколько завершённых сессий хранить |

### Разработка

```bash
npm test            # или: node --test tests/
```

В `scripts/stats.js` только чистые функции, поэтому тесты запускаются без Foundry.

### Ручная проверка

1. **Обычный d20**: игрок вводит `/r 1d20`. Через 3 с у ГМ `api.status().d20Rolls` увеличится на 1.
2. **Преимущество**: `/r 2d20kh`. Учитывается только оставленный куб (+1, а не +2).
3. **Урон**: бросок урона (в PF2e — урон от удара). По умолчанию не учитывается. С настройкой
   *Учитывать броски урона* увеличивает число кубов и колонку «Инд.».
4. **Скрытый бросок**: режим *Слепой бросок ГМ*. Учитывается при включённой настройке скрытых
   бросков и пропускается при выключенной (`status().skipped.hidden`).
5. **Перезагрузка**: начать сессию, сделать броски, нажать F5 у ГМ. Появится «учёт продолжается»,
   счётчики сохранятся, новые броски будут добавляться.
6. **Стоп**: отчёт опубликован. В окне *Сессии* архивную сессию можно опубликовать повторно.
