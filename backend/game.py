"""Game state management for the Scrabble auto-scorer."""

import copy
from typing import Dict, List, Optional

from board import BOARD_SIZE, letter_value
from scoring import ScoringError, score_move


class GameError(ValueError):
    """Raised for invalid game operations (bad player count, wrong turn, etc.)."""


class ScrabbleGame:
    def __init__(self, players: List[str], word_set: Optional[set] = None):
        if not (2 <= len(players) <= 4):
            raise GameError("Scrabble supports 2 to 4 players")
        if len(players) != len(set(players)):
            raise GameError("Player names must be unique")

        self.players: List[str] = list(players)
        self.word_set = word_set or set()
        self.board: List[List[Optional[dict]]] = [
            [None for _ in range(BOARD_SIZE)] for _ in range(BOARD_SIZE)
        ]
        self.scores: Dict[str, int] = {p: 0 for p in players}
        self.current_turn_index: int = 0
        self.history: List[dict] = []
        self.turn_number: int = 0
        self.game_over: bool = False
        self.final_scores: Optional[Dict[str, int]] = None
        self.end_game_summary: Optional[Dict] = None

    # ------------------------------------------------------------------
    @property
    def current_player(self) -> str:
        return self.players[self.current_turn_index]

    def _advance_turn(self):
        self.current_turn_index = (self.current_turn_index + 1) % len(self.players)

    # ------------------------------------------------------------------
    def play_word(
        self,
        word: str,
        start_row: int,
        start_col: int,
        direction: str,
        blanks: Optional[List[int]] = None,
        validate_dictionary: bool = True,
    ) -> dict:
        """Validate, score, and apply a word placement for the current player."""
        if self.game_over:
            raise GameError("Game is already over")

        blanks = blanks or []

        if validate_dictionary and self.word_set:
            if word.lower() not in self.word_set:
                raise GameError(f"{word!r} is not a valid word")

        result = score_move(
            word=word,
            start_row=start_row,
            start_col=start_col,
            direction=direction,
            blanks=blanks,
            board_state=self.board,
        )

        # Apply the new tiles to the board
        word_upper = word.upper()
        blanks_set = set(blanks)
        placed_tiles = []
        for i, (r, c) in enumerate(result["positions"]):
            if self.board[r][c] is None:
                tile = {"letter": word_upper[i], "is_blank": i in blanks_set}
                self.board[r][c] = tile
                placed_tiles.append({"row": r, "col": c, **tile})

        player = self.current_player
        self.scores[player] += result["total"]
        self.turn_number += 1

        turn_record = {
            "turn_number": self.turn_number,
            "player": player,
            "word": word_upper,
            "start_row": start_row,
            "start_col": start_col,
            "direction": direction,
            "blanks": list(blanks),
            "placed_tiles": placed_tiles,
            "score_breakdown": {
                "main_word_score": result["main_word_score"],
                "cross_word_scores": result["cross_word_scores"],
                "cross_words": [
                    {"word": cw["word"], "score": cw["score"]}
                    for cw in result["cross_words"]
                ],
                "bingo_bonus": result["bingo_bonus"],
                "total": result["total"],
            },
            "action": "play",
        }
        self.history.append(turn_record)

        self._advance_turn()

        return turn_record

    # ------------------------------------------------------------------
    def skip_turn(self) -> dict:
        if self.game_over:
            raise GameError("Game is already over")

        player = self.current_player
        self.turn_number += 1
        turn_record = {
            "turn_number": self.turn_number,
            "player": player,
            "action": "skip",
            "score_breakdown": {
                "main_word_score": 0,
                "cross_word_scores": [],
                "cross_words": [],
                "bingo_bonus": 0,
                "total": 0,
            },
        }
        self.history.append(turn_record)
        self._advance_turn()
        return turn_record

    # ------------------------------------------------------------------
    def undo_last_move(self) -> dict:
        if not self.history:
            raise GameError("No moves to undo")

        last = self.history.pop()

        # Move back to the player who made that move
        self.current_turn_index = self.players.index(last["player"])
        self.turn_number -= 1

        if last["action"] == "play":
            # Remove placed tiles from the board
            for tile in last["placed_tiles"]:
                self.board[tile["row"]][tile["col"]] = None
            # Roll back the score
            self.scores[last["player"]] -= last["score_breakdown"]["total"]
        # For "skip", nothing else to undo besides turn/history state.

        return last

    # ------------------------------------------------------------------
    def end_game(self, unplayed_letters: Optional[Dict[str, str]] = None) -> Dict:
        """
        Compute final scores: each player loses the sum of their unplayed
        tile values. If exactly one player went out (empty rack), standard
        Scrabble rules award them the sum of everyone else's unplayed
        tiles; callers should pass an empty string for players with no
        unplayed letters.

        Returns a detailed breakdown dict:
            {
                "players": {
                    <name>: {
                        "score_before": int,
                        "unplayed_letters": str,
                        "deduction": int,
                        "went_out_bonus": int,
                        "final_score": int,
                    },
                    ...
                },
                "winner": <name or None>,
            }
        """
        unplayed_letters = unplayed_letters or {}
        scores_before = dict(self.scores)
        final_scores = dict(self.scores)

        total_deducted = 0
        deductions = {}
        letters_by_player = {}
        for player in self.players:
            letters = unplayed_letters.get(player, "")
            letters_by_player[player] = letters
            deduction = sum(letter_value(ch) for ch in letters if ch.strip())
            deductions[player] = deduction
            total_deducted += deduction
            final_scores[player] = final_scores.get(player, 0) - deduction

        # If exactly one player has no unplayed letters (went out), award
        # them the total deducted from everyone else.
        went_out_candidates = [
            p for p in self.players if not unplayed_letters.get(p, "").strip()
        ]
        went_out_bonuses = {p: 0 for p in self.players}
        if len(went_out_candidates) == 1 and total_deducted > 0:
            winner_player = went_out_candidates[0]
            bonus = total_deducted - deductions.get(winner_player, 0)
            went_out_bonuses[winner_player] = bonus
            final_scores[winner_player] += bonus

        self.final_scores = final_scores
        self.game_over = True
        self.scores = final_scores

        players_breakdown = {}
        for player in self.players:
            players_breakdown[player] = {
                "score_before": scores_before.get(player, 0),
                "unplayed_letters": letters_by_player[player],
                "deduction": deductions[player],
                "went_out_bonus": went_out_bonuses[player],
                "final_score": final_scores[player],
            }

        winner = None
        if self.players:
            winner = max(self.players, key=lambda p: final_scores.get(p, 0))

        self.end_game_summary = {
            "players": players_breakdown,
            "winner": winner,
        }
        return self.end_game_summary

    # ------------------------------------------------------------------
    def _serialize_board(self):
        result = []
        for row in self.board:
            row_data = []
            for cell in row:
                if cell is None:
                    row_data.append(None)
                else:
                    row_data.append({
                        "letter": cell["letter"],
                        "isBlank": cell.get("is_blank", False),
                        "points": 0 if cell.get("is_blank", False) else letter_value(cell["letter"]),
                    })
            result.append(row_data)
        return result

    def to_dict(self) -> dict:
        return {
            "players": [
                {"name": p, "score": self.scores.get(p, 0)}
                for p in self.players
            ],
            "board": self._serialize_board(),
            "scores": self.scores,
            "currentPlayerIndex": self.current_turn_index,
            "current_player": self.current_player if not self.game_over else None,
            "history": [
                {
                    "player": h["player"],
                    "word": h.get("word", "(skipped)") if h["action"] == "play" else "(skipped)",
                    "score": h["score_breakdown"]["total"],
                    "action": h["action"],
                    "scoreBreakdown": {
                        "word": h.get("word", ""),
                        "mainWordScore": h["score_breakdown"]["main_word_score"],
                        "crossWords": [
                            {"word": cw["word"], "score": cw["score"]}
                            for cw in h["score_breakdown"].get("cross_words", [])
                        ],
                        "bingoBonus": h["score_breakdown"]["bingo_bonus"],
                        "total": h["score_breakdown"]["total"],
                    },
                }
                for h in self.history
            ],
            "turn_number": self.turn_number,
            "game_over": self.game_over,
            "final_scores": self.final_scores,
            "end_game_summary": self.end_game_summary,
        }
