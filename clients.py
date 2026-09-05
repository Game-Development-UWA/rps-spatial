import random
from typing import Optional

from utils import Point, Positions, Strategy, Vector


def _sign(value):
    if value > 0:
        return 1
    if value < 0:
        return -1
    return 0


def _nearest(origin: Point, positions: Positions) -> Optional[Point]:
    candidates = (position for position in positions if position is not None)
    return min(
        candidates,
        key=lambda position: (position[0] - origin[0]) ** 2 + (position[1] - origin[1]) ** 2,
        default=None,
    )


def _vectors_towards(origins: Positions, targets: Positions, away: bool = False) -> list[Vector]:
    vectors: list[Vector] = []
    for origin in origins:
        if origin is None:
            vectors.append((0, 0))
            continue
        target = _nearest(origin, targets)
        if target is None:
            vectors.append((0, 0))
            continue
        dx, dy = target[0] - origin[0], target[1] - origin[1]
        vectors.append((-dx, -dy) if away else (dx, dy))
    return vectors


def chase_prey(self_positions, prey_positions, predator_positions):
    """Return vectors from each entity towards its nearest prey."""
    return _vectors_towards(self_positions, prey_positions)


def flee_predator(self_positions, prey_positions, predator_positions):
    """Return vectors from each entity away from its nearest predator."""
    return _vectors_towards(self_positions, predator_positions, away=True)


def _clan_vectors(self_positions: Positions, away: bool = False) -> list[Vector]:
    vectors: list[Vector] = []
    for index, origin in enumerate(self_positions):
        if origin is None:
            vectors.append((0, 0))
            continue
        clan_mates = [
            position
            for mate_index, position in enumerate(self_positions)
            if mate_index != index and position is not None
        ]
        target = _nearest(origin, clan_mates)
        if target is None:
            vectors.append((0, 0))
            continue
        dx, dy = target[0] - origin[0], target[1] - origin[1]
        vectors.append((-dx, -dy) if away else (dx, dy))
    return vectors


def gather(self_positions, prey_positions, predator_positions):
    """Return vectors from each entity towards its nearest clan member."""
    return _clan_vectors(self_positions)


def disperse(self_positions, prey_positions, predator_positions):
    """Return vectors from each entity away from its nearest clan member."""
    return _clan_vectors(self_positions, away=True)


class Client:
    def __init__(self, name="client"):
        self.name = name

    def play(self, self_positions, prey_positions, predator_positions):
        raise NotImplementedError("Implement play() in your Client subclass.")


class Strategist(Client):
    """Combine strategy vectors into one of the eight compass directions."""

    def __init__(self, name="strategist", strategies=None, weights=None):
        super().__init__(name)
        self.strategies: tuple[Strategy, ...] = tuple(
            (chase_prey, flee_predator, gather) if strategies is None else strategies
        )
        self.weights = tuple((1,) * len(self.strategies) if weights is None else weights)
        if not self.strategies:
            raise ValueError("Strategist requires at least one strategy")
        if len(self.strategies) != len(self.weights):
            raise ValueError("strategies and weights must have the same length")

    @staticmethod
    def _quantise(vector: Vector) -> tuple[int, int]:
        return (_sign(vector[0]), _sign(vector[1]))

    def play(
        self,
        self_positions: Positions,
        prey_positions: Positions,
        predator_positions: Positions,
    ):
        strategy_vectors = [
            strategy(self_positions, prey_positions, predator_positions)
            for strategy in self.strategies
        ]
        directions = []
        for index in range(len(self_positions)):
            vector = (
                sum(
                    weight * vectors[index][0]
                    for weight, vectors in zip(self.weights, strategy_vectors)
                ),
                sum(
                    weight * vectors[index][1]
                    for weight, vectors in zip(self.weights, strategy_vectors)
                ),
            )
            directions.append(self._quantise(vector))
        return directions


class RandomClient(Client):
    """Trivial client that gives every living entity a random step."""

    def play(self, self_positions, prey_positions, predator_positions):
        directions = [None] * len(self_positions)
        for index, position in enumerate(self_positions):
            if position is not None:
                directions[index] = (random.choice([-1, 0, 1]), random.choice([-1, 0, 1]))
        return directions
