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

  endGamePanel: document.getElementById("end-game-panel"),
  endGameWinner: document.getElementById("end-game-winner"),
  endGamePlayers: document.getElementById("end-game-players"),
};

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
    renderEndGameSummary(data.end_game_summary || data.endGameSummary);
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

function renderHistory() {
  el.historyList.innerHTML = "";

  state.history.forEach((entry) => {
    const li = document.createElement("li");

    const wordSpan = document.createElement("span");
    wordSpan.className = "history-word";
    wordSpan.textContent = entry.word || "(skipped)";

    const metaSpan = document.createElement("span");
    metaSpan.className = "history-meta";
    metaSpan.textContent = `${entry.player} — ${entry.score ?? 0} pts`;

    li.appendChild(wordSpan);
    li.appendChild(metaSpan);
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
    lines.push(`Bingo bonus: +${b.bingoBonus} pts`);
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
    renderEndGameSummary(data.endGameSummary);
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
    lines.push(`<div class="egp-row"><span>Score before deductions</span><span>${info.score_before}</span></div>`);
    lines.push(
      `<div class="egp-row"><span>Unplayed letters</span><span>${info.unplayed_letters ? info.unplayed_letters : "(none)"}</span></div>`
    );
    lines.push(`<div class="egp-row"><span>Deduction</span><span>-${info.deduction}</span></div>`);
    if (info.went_out_bonus) {
      lines.push(`<div class="egp-row egp-bonus"><span>Went-out bonus</span><span>+${info.went_out_bonus}</span></div>`);
    }
    lines.push(`<div class="egp-row egp-final"><span>Final score</span><span>${info.final_score}</span></div>`);

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
