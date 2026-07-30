"""Board layout and constants for the Scrabble auto-scorer."""

BOARD_SIZE = 15

# Bonus type constants
TW = "TW"      # Triple Word
DW = "DW"      # Double Word
TL = "TL"      # Triple Letter
DL = "DL"      # Double Letter
CENTER = "CENTER"  # Center star (acts as Double Word)

# Standard 15x15 Scrabble board layout.
# T=TW, D=DW, t=TL, d=DL, *=CENTER(DW), .=no bonus
_LAYOUT_ROWS = [
    "T..d...T...d..T",
    ".D...t...t...D.",
    "..D...d.d...D..",
    "d..D...d...D..d",
    "....D.....D....",
    ".t...t...t...t.",
    "..d...d.d...d..",
    "T..d...*...d..T",
    "..d...d.d...d..",
    ".t...t...t...t.",
    "....D.....D....",
    "d..D...d...D..d",
    "..D...d.d...D..",
    ".D...t...t...D.",
    "T..d...T...d..T",
]

_SYMBOL_TO_BONUS = {
    "T": TW,
    "D": DW,
    "t": TL,
    "d": DL,
    "*": CENTER,
    ".": None,
}

# Dictionary mapping (row, col) -> bonus type (only entries with a bonus are included)
BOARD_BONUSES = {}
for _row_idx, _row_str in enumerate(_LAYOUT_ROWS):
    for _col_idx, _symbol in enumerate(_row_str):
        _bonus = _SYMBOL_TO_BONUS[_symbol]
        if _bonus is not None:
            BOARD_BONUSES[(_row_idx, _col_idx)] = _bonus

CENTER_SQUARE = (7, 7)

# Standard Scrabble letter point values
LETTER_VALUES = {
    "A": 1, "E": 1, "I": 1, "O": 1, "U": 1, "L": 1, "N": 1, "S": 1, "T": 1, "R": 1,
    "D": 2, "G": 2,
    "B": 3, "C": 3, "M": 3, "P": 3,
    "F": 4, "H": 4, "V": 4, "W": 4, "Y": 4,
    "K": 5,
    "J": 8, "X": 8,
    "Q": 10, "Z": 10,
}


def letter_value(letter: str, is_blank: bool = False) -> int:
    """Return the point value of a letter tile. Blanks are always 0."""
    if is_blank:
        return 0
    return LETTER_VALUES.get(letter.upper(), 0)


def get_bonus(row: int, col: int):
    """Return the bonus type at (row, col), or None if there is no bonus."""
    return BOARD_BONUSES.get((row, col))


def in_bounds(row: int, col: int) -> bool:
    return 0 <= row < BOARD_SIZE and 0 <= col < BOARD_SIZE
