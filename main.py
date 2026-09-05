import random
import sys
from pathlib import Path

from clients import Strategist, chase_prey, disperse, flee_predator, gather
from server import Server


def demo_players():
    return [
        Strategist(
            "rock-strategist",
            strategies=(chase_prey, gather),
            weights=(3, 0.75),
        ),
        Strategist(
            "paper-strategist",
            strategies=(flee_predator, chase_prey, gather),
            weights=(3, 2, 1),
        ),
        Strategist(
            "scissors-strategist",
            strategies=(disperse, chase_prey, flee_predator),
            weights=(2, 2, 1),
        ),
    ]


def run_demo(verbose=True):
    random.seed(42)
    server = Server(demo_players(), grid_size=(25, 25), entities_per_clan=25, max_ticks=500)
    return server.run(verbose=verbose)


def main():
    history = run_demo(verbose=True)
    print("Final:", history[-1])


if __name__ == "__main__":
    main()
