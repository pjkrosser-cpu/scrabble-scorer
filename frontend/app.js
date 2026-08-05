/* ============================================================
   Scrabble Scorer — Frontend Logic
   ------------------------------------------------------------
   This file talks to a backend API to run the game. The backend
   owns all the "real" state (board, scores, dictionary checks).
   This file's job is just to:
     1. Show the setup screen and start a game
     2. Render whatever board/score state the server gives us
     3. Let the player build a move (position, direction, word,
        blanks) and send it to the server
     4. Show the result (score breakdown or error)
   ============================================================ */

const API_BASE = window.location.origin;

// Standard Scrabble premium-square layout (15 rows x 15 cols).
// Short codes: TW, DW, TL, DL, ST (star/center), .. (empty square)
const PREMIUM_LAYOUT = [
  ["TW","..","..","DL","..","..","..","TW","..","..","..","DL","..","..","TW"],
  ["..","DW","..","..","..","TL","..","..","..","TL","..","..","..","DW",".."],
  ["..","..","DW","..","..","..","DL","..","DL","..","..","..","DW","..",".."],
  ["DL","..","..","DW","..","..","..","DL","..","..","..","DW","..","..","DL"],
  ["..","..","..","..","DW","..","..","..","..","..","DW","..","..","..",".."],
  ["..","TL","..","..","..","TL","..","..","..","TL","..","..","..","TL",".."],
  ["..","..","DL","..","..","..","DL","..","DL","..","..","..","DL","..",".."],
  ["TW","..","..","DL","..","..","..","ST","..","..","..","DL","..","..","TW"],
  ["..","..","DL","..","..","..","DL","..","DL","..","..","..","DL","..",".."],
  ["..","TL","..","..","..","TL","..","..","..","TL","..","..","..","TL",".."],
  ["..","..","..","..","DW","..","..","..","..","..","DW","..","..","..",".."],
  ["DL","..","..","DW","..","..","..","DL","..","..","..","DW","..","..","DL"],
  ["..","..","DW","..","..","..","DL","..","DL","..","..","..","DW","..",".."],
  ["..","DW","..","..","..","TL","..","..","..","TL","..","..","..","DW",".."],
  ["TW","..","..","DL","..","..","..","TW","..","..","..","DL","..","..","TW"],
];

// ------------------------------------------------------------
// Application state kept on the client (mirrors the server,
// plus some UI-only fields like the in-progress move).
// ------------------------------------------------------------
const state = {
  gameStarted: false,
  players: [],       // [{ name, score }]
  currentPlayerIndex: 0,
  board: null,        // 15x15 array of { letter, points, isBlank } or null
  history: [],         // [{ player, word, score }]
  endGameSummary: null, // set once the game has ended

  // In-progress move the player is building
  selectedRow: null,
  selectedCol: null,
  direction: "across", // "across" | "down"
  wordInput: "",
  blankIndices: new Set(), // indices (into wordInput) marked as blanks

  lastInvalidWord: null, // word text that failed dictionary check, for override
};

// ------------------------------------------------------------
// DOM references
// ------------------------------------------------------------
const el = {
  notification: document.getElementById("notification"),

  setupScreen: document.getElementById("setup-screen"),
  playerInputs: document.getElementById("player-inputs"),
  addPlayerBtn: document.getElementById("add-player-btn"),
  removePlayerBtn: document.getElementById("remove-player-btn"),
  startGameBtn: document.getElementById("start-game-btn"),

  gameScreen: document.getElementById("game-screen"),
  turnBanner: document.getElementById("turn-banner"),
  board: document.getElementById("board"),

  scoreboardList: document.getElementById("scoreboard-list"),

  selectedSquare: document.getElementById("selected-square"),
  directionToggle: document.getElementById("direction-toggle"),
  wordInput: document.getElementById("word-input"),
  blankChipRow: document.getElementById("blank-chip-row"),
  blankHint: document.getElementById("blank-hint"),
  playWordBtn: document.getElementById("play-word-btn"),
  clearSelectionBtn: document.getElementById("clear-selection-btn"),
  scoreBreakdown: document.getElementById("score-breakdown"),
  invalidWordActions: document.getElementById("invalid-word-actions"),
  overrideWordBtn: document.getElementById("override-word-btn"),

  skipTurnBtn: document.getElementById("skip-turn-btn"),
  undoBtn: document.getElementById("undo-btn"),
  endGameBtn: document.getElementById("end-game-btn"),
  newGameBtn: document.getElementById("new-game-btn"),

  historyList: document.getElementById("history-list"),
  printBoxScoreBtn: document.getElementById("print-box-score-btn"),

  endGamePanel: document.getElementById("end-game-panel"),
  endGameWinner: document.getElementById("end-game-winner"),
  endGamePlayers: document.getElementById("end-game-players"),
};

// ============================================================
// Help tooltips (pure CSS tooltip, JS only toggles for tap/mobile)
// ============================================================

// Returns an HTML snippet for a small circular "?" icon that shows an
// explanatory tooltip on hover (desktop) or tap (mobile/click, via the
// delegated click handler registered below).
function helpIconHtml(text) {
  const escaped = String(text).replace(/"/g, "&quot;");
  return `<span class="help-icon" tabindex="0" role="button" aria-label="Help: ${escaped}">?<span class="tooltip-text">${text}</span></span>`;
}

// Tap/click toggling for mobile (hover alone doesn't work well on touch
// devices). Uses event delegation since help icons are re-created on
// every render.
document.addEventListener("click", (event) => {
  const icon = event.target.closest(".help-icon");

  document.querySelectorAll(".help-icon.show-tooltip").forEach((openIcon) => {
    if (openIcon !== icon) openIcon.classList.remove("show-tooltip");
  });

  if (icon) {
    icon.classList.toggle("show-tooltip");
    event.stopPropagation();
  }
});

// ============================================================
// Notifications
// ============================================================

let notificationTimer = null;

function showNotification(message, type = "error") {
  el.notification.textContent = message;
  el.notification.classList.remove("hidden", "notice");
  if (type === "notice") {
    el.notification.classList.add("notice");
  }

  clearTimeout(notificationTimer);
  notificationTimer = setTimeout(() => {
    el.notification.classList.add("hidden");
  }, 5000);
}

// ============================================================
// API helpers
// ============================================================

async function apiPost(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const msg = data.error || data.detail || "Something went wrong. Please try again.";
    const err = new Error(msg);
    err.data = data;
    throw err;
  }

  return data;
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE}${path}`);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong. Please try again.");
  }

  return data;
}

// ============================================================
// Setup screen
// ============================================================

function addPlayerInput() {
  const inputs = el.playerInputs.querySelectorAll(".player-name-input");
  if (inputs.length >= 4) {
    showNotification("You can have at most 4 players.");
    return;
  }
  const input = document.createElement("input");
  input.type = "text";
  input.className = "player-name-input";
  input.placeholder = `Player ${inputs.length + 1} name`;
  el.playerInputs.appendChild(input);
}

function removePlayerInput() {
  const inputs = el.playerInputs.querySelectorAll(".player-name-input");
  if (inputs.length <= 2) {
    showNotification("You need at least 2 players.");
    return;
  }
  el.playerInputs.removeChild(inputs[inputs.length - 1]);
}

async function startGame() {
  const inputs = el.playerInputs.querySelectorAll(".player-name-input");
  const names = Array.from(inputs)
    .map((input) => input.value.trim())
    .filter((name) => name.length > 0);

  if (names.length < 2) {
    showNotification("Please enter at least 2 player names.");
    return;
  }

  try {
    const data = await apiPost("/api/new-game", { players: names });
    applyGameState(data);
    hideEndGameSummary();
    state.gameStarted = true;
    el.setupScreen.classList.add("hidden");
    el.gameScreen.classList.remove("hidden");
  } catch (err) {
    showNotification(err.message);
  }
}

// ============================================================
// Fetching / applying game state from the server
// ============================================================

async function refreshGameState() {
  try {
    const data = await apiGet("/api/game-state");
    applyGameState(data);
  } catch (err) {
    showNotification(err.message);
  }
}

// Normalizes whatever shape the server sends into our state object,
// then re-renders everything on screen.
function applyGameState(data) {
  state.players = data.players || state.players;
  state.currentPlayerIndex = data.currentPlayerIndex ?? state.currentPlayerIndex;
  state.board = data.board || state.board;
  if (data.history) {
    state.history = data.history;
  }

  renderScoreboard();
  renderBoard();
  renderHistory();
  renderTurnBanner();

  if (data.end_game_summary || data.endGameSummary) {
    state.endGameSummary = data.end_game_summary || data.endGameSummary;
    renderEndGameSummary(state.endGameSummary);
  }
}

// ============================================================
// Board rendering
// ============================================================

function renderBoard() {
  el.board.innerHTML = "";

  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.row = row;
      cell.dataset.col = col;

      const premium = PREMIUM_LAYOUT[row][col];
      applyPremiumStyling(cell, premium);

      const placedTile = state.board && state.board[row] ? state.board[row][col] : null;
      if (placedTile) {
        cell.appendChild(buildTileElement(placedTile.letter, placedTile.points, placedTile.isBlank));
      }

      if (row === state.selectedRow && col === state.selectedCol) {
        cell.classList.add("selected-start");
      }

      cell.addEventListener("click", () => onCellClick(row, col));
      el.board.appendChild(cell);
    }
  }

  renderWordPreview();
}

function applyPremiumStyling(cell, premium) {
  if (premium === "ST") {
    cell.classList.add("premium-center");
    const star = document.createElement("span");
    star.className = "center-star";
    star.textContent = "★";
    cell.appendChild(star);
    return;
  }

  if (premium === "..") {
    return; // plain square, nothing to add
  }

  const classMap = { TW: "premium-tw", DW: "premium-dw", TL: "premium-tl", DL: "premium-dl" };
  cell.classList.add(classMap[premium]);

  const label = document.createElement("span");
  label.className = "premium-label";
  label.textContent = premium;
  cell.appendChild(label);
}

function buildTileElement(letter, points, isBlank) {
  const tile = document.createElement("div");
  tile.className = "tile" + (isBlank ? " blank-tile" : "");

  const letterSpan = document.createElement("span");
  letterSpan.className = "tile-letter";
  letterSpan.textContent = letter;
  tile.appendChild(letterSpan);

  const pointsSpan = document.createElement("span");
  pointsSpan.className = "tile-points";
  pointsSpan.textContent = points ?? "";
  tile.appendChild(pointsSpan);

  return tile;
}

// Standard Scrabble letter values, used only for the client-side
// preview (the server computes the real, authoritative score).
const LETTER_POINTS = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

// Shows a faint outline preview of where the typed word would land,
// without touching the real board data.
function renderWordPreview() {
  if (state.selectedRow === null || state.selectedCol === null) return;
  const word = state.wordInput.trim().toUpperCase();
  if (!word) return;

  for (let i = 0; i < word.length; i++) {
    const row = state.direction === "down" ? state.selectedRow + i : state.selectedRow;
    const col = state.direction === "across" ? state.selectedCol + i : state.selectedCol;
    if (row > 14 || col > 14) break; // ran off the board

    const cell = el.board.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
    if (!cell) continue;

    const alreadyOccupied = state.board && state.board[row] && state.board[row][col];
    if (alreadyOccupied) continue; // don't cover existing tiles with a preview

    // Clear any premium label so the preview tile is easy to read
    cell.innerHTML = "";
    const letter = word[i];
    const isBlank = state.blankIndices.has(i);
    const tile = buildTileElement(letter, LETTER_POINTS[letter] || "", isBlank);
    tile.classList.add("preview-tile");
    cell.appendChild(tile);
  }
}

// ============================================================
// Scoreboard rendering
// ============================================================

function renderScoreboard() {
  el.scoreboardList.innerHTML = "";

  state.players.forEach((player, index) => {
    const li = document.createElement("li");
    if (index === state.currentPlayerIndex) {
      li.classList.add("current-player");
    }

    const nameSpan = document.createElement("span");
    nameSpan.className = "player-name";
    nameSpan.textContent = player.name;

    const scoreSpan = document.createElement("span");
    scoreSpan.className = "player-score";
    scoreSpan.textContent = player.score;

    li.appendChild(nameSpan);
    li.appendChild(scoreSpan);
    el.scoreboardList.appendChild(li);
  });
}

function renderTurnBanner() {
  const player = state.players[state.currentPlayerIndex];
  el.turnBanner.textContent = player ? `${player.name}'s turn` : "";
}

// ============================================================
// History rendering
// ============================================================

const BINGO_TOOLTIP_TEXT =
  "A Bingo is when you play all 7 tiles from your rack in a single turn, earning a 50-point bonus.";

function renderHistory() {
  el.historyList.innerHTML = "";

  // Running total per player, built up as we walk through the turns in
  // order, so each card can show "where the score stood" at that point.
  const runningTotals = {};
  state.players.forEach((p) => {
    runningTotals[p.name] = 0;
  });

  state.history.forEach((entry, index) => {
    const turnNumber = index + 1;
    const isSkip = entry.action === "skip" || !entry.word || entry.word === "(skipped)";
    const breakdown = entry.scoreBreakdown || {};

    runningTotals[entry.player] = (runningTotals[entry.player] || 0) + (entry.score ?? 0);

    const li = document.createElement("li");
    li.className = "history-card" + (breakdown.bingoBonus ? " is-bingo" : "");

    const header = document.createElement("div");
    header.className = "hc-header";
    header.innerHTML =
      `<span class="hc-turn">Turn ${turnNumber}</span>` +
      `<span class="hc-player">${entry.player}</span>` +
      `<span class="hc-total">${entry.score ?? 0} pts</span>`;
    li.appendChild(header);

    const wordRow = document.createElement("div");
    wordRow.className = "hc-word-row";
    if (isSkip) {
      wordRow.innerHTML = `<span class="hc-word hc-skipped">SKIPPED</span>`;
    } else {
      wordRow.innerHTML =
        `<span class="hc-word">${entry.word}</span>` +
        `<span class="hc-main-score">${breakdown.mainWordScore ?? entry.score ?? 0} pts</span>`;
    }
    li.appendChild(wordRow);

    if (!isSkip) {
      const badges = document.createElement("div");
      badges.className = "hc-badges";
      let hasBadges = false;

      (breakdown.crossWords || []).forEach((cw) => {
        const badge = document.createElement("span");
        badge.className = "hc-badge hc-badge-cross";
        badge.textContent = `+${cw.score} cross (${cw.word})`;
        badges.appendChild(badge);
        hasBadges = true;
      });

      if (breakdown.bingoBonus) {
        const badge = document.createElement("span");
        badge.className = "hc-badge hc-badge-bingo";
        badge.innerHTML = `+${breakdown.bingoBonus} BINGO${helpIconHtml(BINGO_TOOLTIP_TEXT)}`;
        badges.appendChild(badge);
        hasBadges = true;
      }

      if (hasBadges) {
        li.appendChild(badges);
      }
    }

    const runningRow = document.createElement("div");
    runningRow.className = "hc-running";
    runningRow.textContent = `${entry.player} total: ${runningTotals[entry.player]} pts`;
    li.appendChild(runningRow);

    el.historyList.appendChild(li);
  });

  el.historyList.scrollTop = el.historyList.scrollHeight;
}

// ============================================================
// Move building: square selection, direction, word, blanks
// ============================================================

function onCellClick(row, col) {
  state.selectedRow = row;
  state.selectedCol = col;
  el.selectedSquare.textContent = `Row ${row + 1}, Col ${col + 1}`;
  renderBoard();
}

function toggleDirection() {
  state.direction = state.direction === "across" ? "down" : "across";
  el.directionToggle.textContent = state.direction === "across" ? "Across →" : "Down ↓";
  renderBoard();
}

function onWordInputChange() {
  state.wordInput = el.wordInput.value;
  // Reset blanks whenever the word text changes, since indices may
  // no longer line up with the new letters.
  state.blankIndices.clear();
  renderBlankChips();
  renderBoard();
}

// Builds the row of clickable letter chips under the word input,
// used to mark which letters are blank tiles.
function renderBlankChips() {
  el.blankChipRow.innerHTML = "";
  const word = state.wordInput.trim().toUpperCase();

  if (!word) {
    el.blankHint.classList.add("hidden");
    return;
  }
  el.blankHint.classList.remove("hidden");

  for (let i = 0; i < word.length; i++) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "letter-chip" + (state.blankIndices.has(i) ? " is-blank" : "");
    chip.textContent = word[i];
    chip.addEventListener("click", () => toggleBlank(i));
    el.blankChipRow.appendChild(chip);
  }
}

function toggleBlank(index) {
  if (state.blankIndices.has(index)) {
    state.blankIndices.delete(index);
  } else {
    state.blankIndices.add(index);
  }
  renderBlankChips();
  renderBoard();
}

function clearSelection() {
  state.selectedRow = null;
  state.selectedCol = null;
  state.wordInput = "";
  state.blankIndices.clear();
  el.wordInput.value = "";
  el.selectedSquare.textContent = "None selected";
  hideScoreBreakdown();
  hideInvalidWordActions();
  renderBlankChips();
  renderBoard();
}

// ============================================================
// Playing a word
// ============================================================

function validateMoveInputs() {
  if (state.selectedRow === null || state.selectedCol === null) {
    showNotification("Click a square on the board to choose where the word starts.");
    return false;
  }
  const word = state.wordInput.trim();
  if (!word) {
    showNotification("Type the word you want to play.");
    return false;
  }
  return true;
}

async function playWord(overrideDictionary = false) {
  if (!validateMoveInputs()) return;

  const word = state.wordInput.trim().toUpperCase();
  const payload = {
    word,
    start_row: state.selectedRow,
    start_col: state.selectedCol,
    direction: state.direction,
    blanks: Array.from(state.blankIndices).sort((a, b) => a - b),
    override: overrideDictionary,
  };

  try {
    const data = await apiPost("/api/play-word", payload);
    hideInvalidWordActions();
    showScoreBreakdown(data);
    applyGameState(data.game_state || data);
    resetMoveAfterPlay();
  } catch (err) {
    // If the server flags this specifically as a dictionary miss,
    // offer the override option instead of just showing an error.
    if (err.data && err.data.invalidWord) {
      state.lastInvalidWord = word;
      showInvalidWordActions();
    } else {
      showNotification(err.message);
    }
  }
}

function showScoreBreakdown(data) {
  if (!data.scoreBreakdown) {
    el.scoreBreakdown.classList.add("hidden");
    return;
  }

  const b = data.scoreBreakdown;
  const lines = [];
  lines.push(`<strong>${b.word || state.wordInput.toUpperCase()}</strong>: ${b.mainWordScore ?? 0} pts`);

  if (b.crossWords && b.crossWords.length > 0) {
    b.crossWords.forEach((cw) => {
      lines.push(`Cross word "${cw.word}": ${cw.score} pts`);
    });
  }

  if (b.bingoBonus) {
    lines.push(`Bingo${helpIconHtml(BINGO_TOOLTIP_TEXT)} bonus: +${b.bingoBonus} pts`);
  }

  lines.push(`<strong>Total: ${b.total ?? 0} pts</strong>`);

  el.scoreBreakdown.innerHTML = lines.join("<br>");
  el.scoreBreakdown.classList.remove("hidden");
}

function hideScoreBreakdown() {
  el.scoreBreakdown.classList.add("hidden");
  el.scoreBreakdown.innerHTML = "";
}

function showInvalidWordActions() {
  el.invalidWordActions.classList.remove("hidden");
}

function hideInvalidWordActions() {
  el.invalidWordActions.classList.add("hidden");
  state.lastInvalidWord = null;
}

function resetMoveAfterPlay() {
  state.selectedRow = null;
  state.selectedCol = null;
  state.wordInput = "";
  state.blankIndices.clear();
  el.wordInput.value = "";
  el.selectedSquare.textContent = "None selected";
  renderBlankChips();
}

// ============================================================
// Other turn actions
// ============================================================

async function skipTurn() {
  try {
    const data = await apiPost("/api/skip-turn");
    applyGameState(data.game_state || data);
    resetMoveAfterPlay();
    hideScoreBreakdown();
    hideInvalidWordActions();
  } catch (err) {
    showNotification(err.message);
  }
}

async function undoLastMove() {
  try {
    const data = await apiPost("/api/undo");
    applyGameState(data.game_state || data);
    resetMoveAfterPlay();
    hideScoreBreakdown();
    hideInvalidWordActions();
    showNotification("Last move undone.", "notice");
  } catch (err) {
    showNotification(err.message);
  }
}

async function endGame() {
  const unplayed = {};
  for (const player of state.players) {
    const letters = window.prompt(
      `${player.name}: enter any unplayed letters remaining on their rack (e.g. "QZ"), or leave blank.`
    );
    unplayed[player.name] = (letters || "").trim().toUpperCase();
  }

  try {
    const data = await apiPost("/api/end-game", { unplayed_letters: unplayed });
    applyGameState(data.game_state || data);
    state.endGameSummary = data.endGameSummary || data.end_game_summary || null;
    renderEndGameSummary(state.endGameSummary);
    showNotification("Game over! See the Final Results panel for the full breakdown.", "notice");
  } catch (err) {
    showNotification(err.message);
  }
}

// ============================================================
// End-game summary rendering
// ============================================================

function hideEndGameSummary() {
  el.endGamePanel.classList.add("hidden");
  el.endGameWinner.innerHTML = "";
  el.endGamePlayers.innerHTML = "";
  state.endGameSummary = null;
}

function renderEndGameSummary(summary) {
  if (!summary || !summary.players) {
    hideEndGameSummary();
    return;
  }

  el.endGameWinner.innerHTML = summary.winner
    ? `🏆 <span class="winner-name">${summary.winner}</span> wins!`
    : "";

  el.endGamePlayers.innerHTML = "";

  Object.entries(summary.players).forEach(([name, info]) => {
    const card = document.createElement("div");
    card.className = "end-game-player-card";
    if (name === summary.winner) {
      card.classList.add("is-winner");
    }

    const lines = [];
    lines.push(`<div class="egp-name">${name}</div>`);
    lines.push(
      `<div class="egp-row"><span>Score before deductions${helpIconHtml("Your total score from all words played during the game, before any end-of-game adjustments.")}</span><span>${info.score_before}</span></div>`
    );
    lines.push(
      `<div class="egp-row"><span>Unplayed letters</span><span>${info.unplayed_letters ? info.unplayed_letters : "(none)"}</span></div>`
    );
    lines.push(
      `<div class="egp-row"><span>Deduction${helpIconHtml("Points subtracted for tiles left on your rack at the end of the game. Each unplayed letter's point value is deducted from your score.")}</span><span>-${info.deduction}</span></div>`
    );
    if (info.went_out_bonus) {
      lines.push(
        `<div class="egp-row egp-bonus"><span>Went-out bonus${helpIconHtml("If you used all your tiles (empty rack) when the game ended, you receive a bonus equal to the sum of all other players' unplayed tile values.")}</span><span>+${info.went_out_bonus}</span></div>`
      );
    }
    lines.push(
      `<div class="egp-row egp-final"><span>Final score${helpIconHtml("Your score after subtracting unplayed tile values and adding any went-out bonus.")}</span><span>${info.final_score}</span></div>`
    );

    card.innerHTML = lines.join("");
    el.endGamePlayers.appendChild(card);
  });

  el.endGamePanel.classList.remove("hidden");
}

function backToSetup() {
  state.gameStarted = false;
  state.players = [];
  state.currentPlayerIndex = 0;
  state.board = null;
  state.history = [];
  clearSelection();
  hideEndGameSummary();

  el.gameScreen.classList.add("hidden");
  el.setupScreen.classList.remove("hidden");
}

// ============================================================
// Print / Save Box Score
// ============================================================

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Builds a standalone, print-friendly HTML document showing the final
// scores, every turn's scoring breakdown, and (if the game has ended)
// the end-game deductions/bonuses. Opens it in a new window and
// triggers the browser's print dialog (which is the native share
// sheet on iPhone, offering Save as PDF / AirDrop / Print).
function buildScorecardHtml() {
  const dateStr = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const sortedPlayers = [...state.players].sort((a, b) => (b.score || 0) - (a.score || 0));
  const topScore = sortedPlayers.length ? sortedPlayers[0].score || 0 : null;

  const scoresRows = sortedPlayers
    .map((p) => {
      const isWinner = p.score === topScore;
      return `
        <tr class="${isWinner ? "winner-row" : ""}">
          <td>${escapeHtml(p.name)}${isWinner ? " &#9819;" : ""}</td>
          <td class="num">${p.score ?? 0}</td>
        </tr>`;
    })
    .join("");

  // Running totals per player as we walk through turns, same idea as
  // the on-screen box score.
  const runningTotals = {};
  state.players.forEach((p) => {
    runningTotals[p.name] = 0;
  });

  const turnRows = state.history
    .map((entry, index) => {
      const turnNumber = index + 1;
      const isSkip = entry.action === "skip" || !entry.word || entry.word === "(skipped)";
      const breakdown = entry.scoreBreakdown || {};
      runningTotals[entry.player] = (runningTotals[entry.player] || 0) + (entry.score ?? 0);

      const extras = [];
      if (!isSkip) {
        (breakdown.crossWords || []).forEach((cw) => {
          extras.push(`+${cw.score} cross word (${escapeHtml(cw.word)})`);
        });
        if (breakdown.bingoBonus) {
          extras.push(`+${breakdown.bingoBonus} BINGO bonus`);
        }
      }

      const wordCell = isSkip
        ? `<span class="skipped">SKIPPED</span>`
        : `<strong>${escapeHtml(entry.word)}</strong>`;

      const mainScoreCell = isSkip ? "&mdash;" : (breakdown.mainWordScore ?? entry.score ?? 0);

      return `
        <tr>
          <td class="num">${turnNumber}</td>
          <td>${escapeHtml(entry.player)}</td>
          <td>${wordCell}</td>
          <td class="num">${mainScoreCell}</td>
          <td class="extras">${extras.join("<br>") || "&nbsp;"}</td>
          <td class="num total-cell">${entry.score ?? 0}</td>
          <td class="num running-cell">${runningTotals[entry.player]}</td>
        </tr>`;
    })
    .join("");

  let endGameSection = "";
  const summary = state.endGameSummary;
  if (summary && summary.players) {
    const endGameRows = Object.entries(summary.players)
      .map(([name, info]) => {
        const isWinner = name === summary.winner;
        return `
          <tr class="${isWinner ? "winner-row" : ""}">
            <td>${escapeHtml(name)}${isWinner ? " &#9819;" : ""}</td>
            <td class="num">${info.score_before}</td>
            <td>${info.unplayed_letters ? escapeHtml(info.unplayed_letters) : "&mdash;"}</td>
            <td class="num">-${info.deduction}</td>
            <td class="num">${info.went_out_bonus ? "+" + info.went_out_bonus : "&mdash;"}</td>
            <td class="num total-cell">${info.final_score}</td>
          </tr>`;
      })
      .join("");

    endGameSection = `
      <section class="section">
        <h2>Final Results${summary.winner ? ` &mdash; ${escapeHtml(summary.winner)} Wins` : ""}</h2>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th class="num">Score Before</th>
              <th>Unplayed Letters</th>
              <th class="num">Deduction</th>
              <th class="num">Went-Out Bonus</th>
              <th class="num">Final Score</th>
            </tr>
          </thead>
          <tbody>${endGameRows}</tbody>
        </table>
      </section>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Scrabble Score Card &mdash; ${escapeHtml(dateStr)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: "Courier New", "SF Mono", Menlo, monospace;
    color: #1a1a1a;
    background: #fff;
    margin: 0;
    padding: 32px;
  }
  .sheet {
    max-width: 760px;
    margin: 0 auto;
  }
  header {
    text-align: center;
    border-bottom: 3px double #1a1a1a;
    padding-bottom: 14px;
    margin-bottom: 22px;
  }
  header h1 {
    margin: 0 0 4px;
    font-size: 1.6rem;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  header .subtitle {
    font-size: 0.9rem;
    color: #444;
  }
  .section {
    margin-bottom: 28px;
    page-break-inside: avoid;
  }
  .section h2 {
    font-size: 1.05rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid #999;
    padding-bottom: 6px;
    margin-bottom: 10px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }
  th, td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid #ddd;
    vertical-align: top;
  }
  th {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: #555;
    border-bottom: 2px solid #999;
  }
  td.num, th.num {
    text-align: right;
    white-space: nowrap;
  }
  .final-scores td {
    font-size: 1.05rem;
    padding: 8px;
  }
  .winner-row td {
    font-weight: bold;
    background: #f5f0e0;
  }
  .skipped {
    font-style: italic;
    color: #777;
  }
  .extras {
    font-size: 0.76rem;
    color: #555;
  }
  .total-cell {
    font-weight: bold;
  }
  .running-cell {
    color: #555;
  }
  footer {
    margin-top: 24px;
    text-align: center;
    font-size: 0.72rem;
    color: #888;
    border-top: 1px solid #ddd;
    padding-top: 10px;
  }

  @media print {
    body { padding: 0.4in; }
    @page { margin: 0.5in; }
    .section { page-break-inside: avoid; }
    header { page-break-after: avoid; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <header>
      <h1>Scrabble Score Card</h1>
      <div class="subtitle">${escapeHtml(dateStr)}</div>
    </header>

    <section class="section">
      <h2>Final Scores</h2>
      <table class="final-scores">
        <thead>
          <tr><th>Player</th><th class="num">Score</th></tr>
        </thead>
        <tbody>${scoresRows}</tbody>
      </table>
    </section>

    <section class="section">
      <h2>Turn-by-Turn Breakdown</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Word</th>
            <th class="num">Word&nbsp;Score</th>
            <th>Bonuses</th>
            <th class="num">Turn&nbsp;Total</th>
            <th class="num">Running&nbsp;Total</th>
          </tr>
        </thead>
        <tbody>${turnRows || `<tr><td colspan="7" class="skipped">No turns played yet.</td></tr>`}</tbody>
      </table>
    </section>

    ${endGameSection}

    <footer>Scrabble Scorer &mdash; generated ${escapeHtml(new Date().toLocaleString())}</footer>
  </div>
</body>
</html>`;
}

function printBoxScore() {
  if (!state.players.length) {
    showNotification("Start a game before printing a box score.");
    return;
  }

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    showNotification("Please allow pop-ups to print the box score.");
    return;
  }

  const html = buildScorecardHtml();
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();

  printWindow.focus();

  // Trigger the print dialog once the new window has laid out its
  // content. Guarded so we never call print() twice (some browsers
  // fire onload after document.write() completes, others don't).
  let hasPrinted = false;
  const triggerPrint = () => {
    if (hasPrinted) return;
    hasPrinted = true;
    printWindow.print();
  };
  printWindow.onload = triggerPrint;
  setTimeout(triggerPrint, 300);
}

// ============================================================
// Wiring up event listeners
// ============================================================

el.addPlayerBtn.addEventListener("click", addPlayerInput);
el.removePlayerBtn.addEventListener("click", removePlayerInput);
el.startGameBtn.addEventListener("click", startGame);

el.directionToggle.addEventListener("click", toggleDirection);
el.wordInput.addEventListener("input", onWordInputChange);
el.playWordBtn.addEventListener("click", () => playWord(false));
el.overrideWordBtn.addEventListener("click", () => playWord(true));
el.clearSelectionBtn.addEventListener("click", clearSelection);

el.skipTurnBtn.addEventListener("click", skipTurn);
el.undoBtn.addEventListener("click", undoLastMove);
el.endGameBtn.addEventListener("click", endGame);
el.newGameBtn.addEventListener("click", backToSetup);

el.printBoxScoreBtn.addEventListener("click", printBoxScore);

// If a game is already in progress on the server (e.g. page refresh),
// try loading it. Errors here are expected before any game exists,
// so we stay quiet about them.
(async function init() {
  try {
    const data = await apiGet("/api/game-state");
    if (data && data.players && data.players.length > 0) {
      applyGameState(data);
      state.gameStarted = true;
      el.setupScreen.classList.add("hidden");
      el.gameScreen.classList.remove("hidden");
    }
  } catch (err) {
    // No active game yet — stay on the setup screen.
  }
})();
