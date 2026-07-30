"""Scoring engine for the Scrabble auto-scorer.

This module contains the core scoring logic: given a move (word placement)
and the current board state, it computes the main word score, any
cross-word scores formed by newly placed tiles, and the bingo bonus.
"""

import copy
from typing import Dict, List, Optional, Tuple

from board import (
    BOARD_SIZE,
    DL,
    TL,
    DW,
    TW,
    CENTER,
    get_bonus,
    in_bounds,
    letter_value,
)

WORD_MULTIPLIER_BONUSES = (DW, TW, CENTER)
BINGO_TILE_COUNT = 7
BINGO_BONUS = 50


class ScoringError(ValueError):
    """Raised when a move cannot be scored due to invalid placement."""


def _word_positions(
    start_row: int, start_col: int, direction: str, length: int
) -> List[Tuple[int, int]]:
    """Return the list of (row, col) positions the word occupies."""
    positions = []
    for i in range(length):
        if direction == "across":
            r, c = start_row, start_col + i
        elif direction == "down":
            r, c = start_row + i, start_col
        else:
            raise ScoringError(f"Invalid direction: {direction!r}")
        if not in_bounds(r, c):
            raise ScoringError(f"Position ({r}, {c}) is off the board")
        positions.append((r, c))
    return positions


def _square_word_multiplier(row: int, col: int) -> int:
    """Return the word-score multiplier contributed by a newly placed square.
    The center star does NOT grant a double word bonus."""
    bonus = get_bonus(row, col)
    if bonus == DW:
        return 2
    if bonus == TW:
        return 3
    return 1


def _square_letter_multiplier(row: int, col: int) -> int:
    """Return the letter-score multiplier contributed by a newly placed square."""
    bonus = get_bonus(row, col)
    if bonus == DL:
        return 2
    if bonus == TL:
        return 3
    return 1


def _score_tile(letter: str, is_blank: bool, row: int, col: int, newly_placed: bool) -> int:
    """Score a single tile, applying letter bonuses only if newly placed."""
    base = letter_value(letter, is_blank)
    if newly_placed:
        base *= _square_letter_multiplier(row, col)
    return base


def _get_cross_word(
    working_grid: List[List[Optional[dict]]],
    row: int,
    col: int,
    main_direction: str,
) -> Optional[List[Tuple[int, int]]]:
    """
    Given a newly placed tile at (row, col), find the contiguous perpendicular
    word (list of positions) that passes through it. Returns None if no
    cross-word is formed (i.e. the tile is isolated along that axis).
    """
    if main_direction == "across":
        # cross word runs vertically (down)
        dr, dc = 1, 0
    else:
        # cross word runs horizontally (across)
        dr, dc = 0, 1

    # Walk backward to find the start of the run
    r, c = row, col
    while in_bounds(r - dr, c - dc) and working_grid[r - dr][c - dc] is not None:
        r -= dr
        c -= dc
    start_r, start_c = r, c

    # Walk forward from start to collect the full run
    positions = []
    r, c = start_r, start_c
    while in_bounds(r, c) and working_grid[r][c] is not None:
        positions.append((r, c))
        r += dr
        c += dc

    if len(positions) <= 1:
        return None
    return positions


def score_move(
    word: str,
    start_row: int,
    start_col: int,
    direction: str,
    blanks: List[int],
    board_state: List[List[Optional[dict]]],
) -> Dict:
    """
    Score a Scrabble move.

    Args:
        word: The word being played (letters only, uppercase or lowercase).
        start_row, start_col: 0-indexed starting position.
        direction: "across" or "down".
        blanks: list of indices within `word` that are blank tiles.
        board_state: 15x15 grid; each cell is None or
            {"letter": "A", "is_blank": False}.

    Returns:
        dict with keys:
            main_word_score: int
            cross_word_scores: List[dict] each {"word": pos list omitted, "score": int}
                (list of ints for simplicity, see cross_words for details)
            cross_words: List[dict] with "positions" and "score"
            bingo_bonus: int
            total: int
            newly_placed_count: int
    """
    word = word.upper()
    blanks_set = set(blanks)
    length = len(word)
    if length == 0:
        raise ScoringError("Word must not be empty")

    positions = _word_positions(start_row, start_col, direction, length)

    # Validate against existing board state: any occupied square along the
    # word's path must already contain the same letter.
    for i, (r, c) in enumerate(positions):
        existing = board_state[r][c]
        if existing is not None and existing["letter"].upper() != word[i]:
            raise ScoringError(
                f"Letter mismatch at ({r}, {c}): board has "
                f"{existing['letter']!r}, word has {word[i]!r}"
            )

    # Determine newly placed squares
    newly_placed_positions = [
        (r, c) for (r, c) in positions if board_state[r][c] is None
    ]

    if len(newly_placed_positions) == 0:
        raise ScoringError("Move does not place any new tiles")

    # ---- Main word score ----
    main_score = 0
    word_multiplier = 1
    for i, (r, c) in enumerate(positions):
        existing = board_state[r][c]
        is_new = existing is None
        if is_new:
            letter = word[i]
            is_blank = i in blanks_set
        else:
            letter = existing["letter"]
            is_blank = existing.get("is_blank", False)

        main_score += _score_tile(letter, is_blank, r, c, is_new)

        if is_new:
            word_multiplier *= _square_word_multiplier(r, c)

    main_score *= word_multiplier

    # ---- Build working grid with new tiles placed, for cross-word detection ----
    working_grid = copy.deepcopy(board_state)
    for i, (r, c) in enumerate(positions):
        if working_grid[r][c] is None:
            is_blank = i in blanks_set
            working_grid[r][c] = {"letter": word[i], "is_blank": is_blank}

    # ---- Cross-word scores ----
    cross_words = []
    for i, (r, c) in enumerate(positions):
        if board_state[r][c] is not None:
            continue  # only newly placed tiles can form new cross-words

        cross_positions = _get_cross_word(working_grid, r, c, direction)
        if cross_positions is None:
            continue

        cross_score = 0
        cross_multiplier = 1
        cross_letters = []
        for (cr, cc) in cross_positions:
            cross_letters.append(working_grid[cr][cc]["letter"])
            if (cr, cc) == (r, c):
                # The newly placed tile: bonuses apply
                new_letter = word[i]
                new_is_blank = i in blanks_set
                cross_score += _score_tile(new_letter, new_is_blank, cr, cc, True)
                cross_multiplier *= _square_word_multiplier(cr, cc)
            else:
                existing = board_state[cr][cc]
                cross_score += letter_value(
                    existing["letter"], existing.get("is_blank", False)
                )

        cross_score *= cross_multiplier
        cross_words.append(
            {
                "word": "".join(cross_letters),
                "positions": cross_positions,
                "score": cross_score,
            }
        )

    cross_word_scores = [cw["score"] for cw in cross_words]

    # ---- Bingo bonus ----
    newly_placed_count = len(newly_placed_positions)
    bingo_bonus = BINGO_BONUS if newly_placed_count == BINGO_TILE_COUNT else 0

    total = main_score + sum(cross_word_scores) + bingo_bonus

    return {
        "main_word_score": main_score,
        "cross_word_scores": cross_word_scores,
        "cross_words": cross_words,
        "bingo_bonus": bingo_bonus,
        "total": total,
        "newly_placed_count": newly_placed_count,
        "newly_placed_positions": newly_placed_positions,
        "positions": positions,
    }
