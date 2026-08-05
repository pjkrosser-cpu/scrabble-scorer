import os
import sys

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend")
)

from game import ScrabbleGame


# ---------------------------------------------------------------------
# Went-out bonus: exactly one player has no unplayed letters
# ---------------------------------------------------------------------
def test_went_out_bonus_awarded_to_player_with_empty_rack():
    game = ScrabbleGame(players=["Alice", "Bob"])
    game.scores["Alice"] = 100
    game.scores["Bob"] = 100

    summary = game.end_game(unplayed_letters={"Alice": "", "Bob": "QZ"})

    # Q(10) + Z(10) = 20
    bob_info = summary["players"]["Bob"]
    alice_info = summary["players"]["Alice"]

    assert bob_info["deduction"] == 20
    assert bob_info["went_out_bonus"] == 0
    assert bob_info["final_score"] == 100 - 20

    assert alice_info["deduction"] == 0
    assert alice_info["went_out_bonus"] == 20
    assert alice_info["final_score"] == 100 + 20

    assert summary["winner"] == "Alice"


# ---------------------------------------------------------------------
# No bonus when both/all players still have unplayed letters
# ---------------------------------------------------------------------
def test_no_bonus_when_multiple_players_have_unplayed_letters():
    game = ScrabbleGame(players=["Alice", "Bob"])
    game.scores["Alice"] = 100
    game.scores["Bob"] = 100

    summary = game.end_game(unplayed_letters={"Alice": "AB", "Bob": "QZ"})

    alice_info = summary["players"]["Alice"]
    bob_info = summary["players"]["Bob"]

    # A(1) + B(3) = 4
    assert alice_info["deduction"] == 4
    assert alice_info["went_out_bonus"] == 0
    assert alice_info["final_score"] == 100 - 4

    # Q(10) + Z(10) = 20
    assert bob_info["deduction"] == 20
    assert bob_info["went_out_bonus"] == 0
    assert bob_info["final_score"] == 100 - 20

    assert summary["winner"] == "Alice"


# ---------------------------------------------------------------------
# No bonus when everyone went out (no unplayed letters at all)
# ---------------------------------------------------------------------
def test_no_bonus_when_no_unplayed_letters_at_all():
    game = ScrabbleGame(players=["Alice", "Bob"])
    game.scores["Alice"] = 100
    game.scores["Bob"] = 90

    summary = game.end_game(unplayed_letters={"Alice": "", "Bob": ""})

    assert summary["players"]["Alice"]["went_out_bonus"] == 0
    assert summary["players"]["Bob"]["went_out_bonus"] == 0
    assert summary["players"]["Alice"]["final_score"] == 100
    assert summary["players"]["Bob"]["final_score"] == 90
    assert summary["winner"] == "Alice"


# ---------------------------------------------------------------------
# Breakdown structure sanity check
# ---------------------------------------------------------------------
def test_end_game_breakdown_structure():
    game = ScrabbleGame(players=["Alice", "Bob"])
    game.scores["Alice"] = 150
    game.scores["Bob"] = 140

    summary = game.end_game(unplayed_letters={"Alice": "QZ", "Bob": ""})

    assert summary["players"]["Alice"] == {
        "score_before": 150,
        "unplayed_letters": "QZ",
        "deduction": 20,
        "went_out_bonus": 0,
        "final_score": 130,
    }
    assert summary["players"]["Bob"] == {
        "score_before": 140,
        "unplayed_letters": "",
        "deduction": 0,
        "went_out_bonus": 20,
        "final_score": 160,
    }
    assert summary["winner"] == "Bob"
