from collections.abc import Callable, Sequence
from typing import Optional

Point = tuple[int, int]
Vector = tuple[float, float]
Positions = Sequence[Optional[Point]]
Strategy = Callable[[Positions, Positions, Positions], list[Vector]]

CLANS = ("rock", "paper", "scissors")
CLAN_SYMBOLS = {"rock": "R", "paper": "P", "scissors": "S"}
CLAN_COLORS = {
    "rock": "\033[91m",
    "paper": "\033[93m",
    "scissors": "\033[94m",
}
COLOR_RESET = "\033[0m"

PREY_OF = {"rock": "scissors", "scissors": "paper", "paper": "rock"}
PREDATOR_OF = {prey: predator for predator, prey in PREY_OF.items()}
