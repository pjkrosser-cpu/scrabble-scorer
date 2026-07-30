"""FastAPI application for the Scrabble auto-scorer."""

import os
import sys
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from game import GameError, ScrabbleGame
from scoring import ScoringError

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WORD_LIST_PATH = os.path.join(BASE_DIR, "enable1.txt")
FRONTEND_DIR = os.path.join(os.path.dirname(BASE_DIR), "frontend")

app = FastAPI(title="Scrabble Auto-Scorer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

WORD_SET: set = set()


def load_word_set() -> set:
    words = set()
    if os.path.exists(WORD_LIST_PATH):
        with open(WORD_LIST_PATH, "r") as f:
            for line in f:
                w = line.strip().lower()
                if w:
                    words.add(w)
    return words


@app.on_event("startup")
def startup_event():
    global WORD_SET
    WORD_SET = load_word_set()


GAME: Optional[ScrabbleGame] = None


class NewGameRequest(BaseModel):
    players: List[str]


class PlayWordRequest(BaseModel):
    word: str
    start_row: Optional[int] = None
    start_col: Optional[int] = None
    row: Optional[int] = None
    col: Optional[int] = None
    direction: str
    blanks: Optional[List[int]] = []
    override: Optional[bool] = False


class EndGameRequest(BaseModel):
    unplayed_letters: Optional[Dict[str, str]] = None
    unplayed: Optional[Dict[str, str]] = None


@app.post("/api/new-game")
def new_game(req: NewGameRequest):
    global GAME
    try:
        GAME = ScrabbleGame(players=req.players, word_set=WORD_SET)
    except GameError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return GAME.to_dict()


@app.get("/api/game-state")
def game_state():
    if GAME is None:
        return JSONResponse(status_code=404, content={"error": "No game in progress"})
    return GAME.to_dict()


@app.post("/api/play-word")
def play_word(req: PlayWordRequest):
    if GAME is None:
        return JSONResponse(status_code=404, content={"error": "No game in progress"})

    sr = req.start_row if req.start_row is not None else req.row
    sc = req.start_col if req.start_col is not None else req.col
    if sr is None or sc is None:
        return JSONResponse(status_code=400, content={"error": "Start position required"})

    validate_dict = not req.override

    try:
        turn_record = GAME.play_word(
            word=req.word,
            start_row=sr,
            start_col=sc,
            direction=req.direction,
            blanks=req.blanks or [],
            validate_dictionary=validate_dict,
        )
    except GameError as e:
        msg = str(e)
        is_invalid_word = "not a valid word" in msg.lower()
        return JSONResponse(
            status_code=400,
            content={"error": msg, "invalidWord": is_invalid_word},
        )
    except ScoringError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})

    game_dict = GAME.to_dict()
    game_dict["scoreBreakdown"] = {
        "word": turn_record.get("word", ""),
        "mainWordScore": turn_record["score_breakdown"]["main_word_score"],
        "crossWords": [
            {"word": cw["word"], "score": cw["score"]}
            for cw in turn_record["score_breakdown"].get("cross_words", [])
        ],
        "bingoBonus": turn_record["score_breakdown"]["bingo_bonus"],
        "total": turn_record["score_breakdown"]["total"],
    }
    return game_dict


@app.post("/api/skip-turn")
def skip_turn():
    if GAME is None:
        return JSONResponse(status_code=404, content={"error": "No game in progress"})
    try:
        GAME.skip_turn()
    except GameError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return GAME.to_dict()


@app.post("/api/end-game")
def end_game(req: EndGameRequest):
    if GAME is None:
        return JSONResponse(status_code=404, content={"error": "No game in progress"})
    letters = req.unplayed_letters or req.unplayed or {}
    GAME.end_game(unplayed_letters=letters)
    return GAME.to_dict()


@app.get("/api/validate-word/{word}")
def validate_word(word: str):
    is_valid = word.lower() in WORD_SET
    return {"word": word.upper(), "valid": is_valid}


@app.post("/api/undo")
def undo():
    if GAME is None:
        return JSONResponse(status_code=404, content={"error": "No game in progress"})
    try:
        GAME.undo_last_move()
    except GameError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return GAME.to_dict()


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
