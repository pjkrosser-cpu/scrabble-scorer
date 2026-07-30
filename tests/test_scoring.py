import os
import sys

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend")
)

import pytest

from board import BOARD_SIZE
from scoring import score_move, ScoringError


def empty_board():
    return [[None for _ in range(BOARD_SIZE)] for _ in range(BOARD_SIZE)]


def place(board, row, col, letter, is_blank=False):
    board[row][col] = {"letter": letter, "is_blank": is_blank}


# ---------------------------------------------------------------------
# 1. Simple word with no bonuses
# ---------------------------------------------------------------------
def test_simple_word_no_bonuses():
    board = empty_board()
    # row2 cols 3,4,5 are all plain squares
    result = score_move("CAT", 2, 3, "across", [], board)
    assert result["main_word_score"] == 5  # C(3)+A(1)+T(1)
    assert result["cross_word_scores"] == []
    assert result["bingo_bonus"] == 0
    assert result["total"] == 5


# ---------------------------------------------------------------------
# 2. Word crossing one DL square (newly placed)
# ---------------------------------------------------------------------
def test_word_with_dl_square():
    board = empty_board()
    # row0 col3 is DL; cols 1,2 plain
    result = score_move("AID", 0, 1, "across", [], board)
    # A(1) + I(1) + D(2*2=4) = 6, no word multiplier
    assert result["main_word_score"] == 6
    assert result["total"] == 6


# ---------------------------------------------------------------------
# 3. Word crossing one TW square (newly placed)
# ---------------------------------------------------------------------
def test_word_with_tw_square():
    board = empty_board()
    # row0 col0 is TW; cols1,2 plain
    result = score_move("CAT", 0, 0, "across", [], board)
    # (C3 + A1 + T1) * 3 = 15
    assert result["main_word_score"] == 15
    assert result["total"] == 15


# ---------------------------------------------------------------------
# 4. Word crossing both DL and TW together
# ---------------------------------------------------------------------
def test_word_with_dl_and_tw():
    board = empty_board()
    # row0: col0=TW, col1='.', col2='.', col3=DL
    result = score_move("CARD", 0, 0, "across", [], board)
    # C(3) + A(1) + R(1) + D(2*2=4) = 9, * TW(3) = 27
    assert result["main_word_score"] == 27
    assert result["total"] == 27


# ---------------------------------------------------------------------
# 5. Word reusing previously-placed tiles (bonus must NOT reapply)
# ---------------------------------------------------------------------
def test_reused_tile_bonus_not_reapplied():
    board = empty_board()
    # Pre-place C at the center square (DW), as if from a previous turn
    place(board, 7, 7, "C")

    result = score_move("COW", 7, 7, "down", [], board)
    # C existing (7,7): base value only = 3 (no DW reapplied)
    # O new (8,7): plain square = 1
    # W new (9,7): plain square = 4
    assert result["main_word_score"] == 3 + 1 + 4
    assert result["total"] == 8
    assert result["cross_word_scores"] == []


# ---------------------------------------------------------------------
# 6. Bingo +50 bonus (7 tiles placed)
# ---------------------------------------------------------------------
def test_bingo_bonus():
    board = empty_board()
    # row5 cols2-8: only col5 has a TL bonus among these
    result = score_move("AAAAAAA", 5, 2, "across", [], board)
    # 6 plain A's (1 each) + 1 A on TL (1*3=3) = 9, no word multiplier
    assert result["main_word_score"] == 9
    assert result["bingo_bonus"] == 50
    assert result["newly_placed_count"] == 7
    assert result["total"] == 59


# ---------------------------------------------------------------------
# 7. Blank tile scoring as 0
# ---------------------------------------------------------------------
def test_blank_tile_scores_zero():
    board = empty_board()
    # row2 cols 3,4,5 plain; index 1 (col4) is blank representing 'A'
    result = score_move("CAT", 2, 3, "across", [1], board)
    # C(3) + blank-A(0) + T(1) = 4
    assert result["main_word_score"] == 4
    assert result["total"] == 4


# ---------------------------------------------------------------------
# 8. Blank tile on a DW square still doubles the word
# ---------------------------------------------------------------------
def test_blank_on_dw_still_doubles():
    board = empty_board()
    # row1 col1 is DW; use that for the blank
    result = score_move("CAT", 1, 1, "across", [0], board)
    # blank-C(0) + A(1) + T(1) = 2, * DW(2) = 4
    assert result["main_word_score"] == 4
    assert result["total"] == 4


# ---------------------------------------------------------------------
# 9. Cross-word scoring: placing tiles that form perpendicular words
# ---------------------------------------------------------------------
def test_cross_word_scoring():
    board = empty_board()
    # Pre-existing word "CAT" across row7 cols7-9 (from a previous turn)
    place(board, 7, 7, "C")
    place(board, 7, 8, "A")
    place(board, 7, 9, "T")

    # Now play "SO" across row8 cols7-8
    result = score_move("SO", 8, 7, "across", [], board)

    # Main word "SO": S(1, plain) + O(1*2 DL at (8,8)=2) = 3, no word mult
    assert result["main_word_score"] == 3

    # Cross word at col7: "CS" -> C(3 existing) + S(1 new, plain) = 4
    # Cross word at col8: "AO" -> A(1 existing) + O(1*2 DL new) = 3
    assert sorted(result["cross_word_scores"]) == [3, 4]

    assert result["total"] == 3 + 4 + 3


# ---------------------------------------------------------------------
# 10. First word through center star — no DW bonus per house rules
# ---------------------------------------------------------------------
def test_first_word_through_center():
    board = empty_board()
    result = score_move("AT", 7, 7, "across", [], board)
    # A(1) + T(1) = 2, center star does NOT double
    assert result["main_word_score"] == 2
    assert result["total"] == 2


# ---------------------------------------------------------------------
# 11. Multiple word multipliers stacking (DW + TW = x6)
# ---------------------------------------------------------------------
def test_multiplier_stacking():
    board = empty_board()
    # row0 cols0-6: col0=TW, col7=TW — place across both TW squares
    # Use row0 which has TW at col0 and TW at col7
    result = score_move("AAAAAAAA", 0, 0, "across", [], board)
    # col0=TW, col1='.', col2='.', col3=DL, col4-6='.', col7=TW
    # letters: 7 plain A's (1 each) + 1 A on DL at col3 (1*2=2) = 9
    # word multiplier = TW(3) * TW(3) = 9
    assert result["main_word_score"] == 9 * 9
    assert result["main_word_score"] == 81
    assert result["total"] == 81


# ---------------------------------------------------------------------
# Extra sanity checks
# ---------------------------------------------------------------------
def test_letter_mismatch_raises():
    board = empty_board()
    place(board, 2, 3, "X")
    with pytest.raises(ScoringError):
        score_move("CAT", 2, 3, "across", [], board)


def test_no_new_tiles_raises():
    board = empty_board()
    place(board, 2, 3, "C")
    place(board, 2, 4, "A")
    place(board, 2, 5, "T")
    with pytest.raises(ScoringError):
        score_move("CAT", 2, 3, "across", [], board)
