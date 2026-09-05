import random
from time import sleep

from utils import CLAN_COLORS, CLAN_SYMBOLS, CLANS, COLOR_RESET, PREDATOR_OF, PREY_OF, Point


def _sign(value):
    if value > 0:
        return 1
    if value < 0:
        return -1
    return 0


def _clamp(value, low, high):
    return max(low, min(high, value))


class Game:
    def __init__(
        self,
        players,
        grid_size=(400, 400),
        entities_per_clan=25,
        array_size=50,
        hunger=False,
        reproduction=False,
        hunger_ticks=10,
        reproduction_prey=3,
    ):
        if len(players) != 3:
            raise ValueError("Game requires exactly 3 players.")
        if entities_per_clan > array_size:
            raise ValueError("entities_per_clan cannot exceed array_size.")
        if hunger_ticks < 1:
            raise ValueError("hunger_ticks must be at least 1.")
        if reproduction_prey < 1:
            raise ValueError("reproduction_prey must be at least 1.")

        self.players = dict(zip(CLANS, players))
        self.width, self.height = grid_size
        self.entities_per_clan = entities_per_clan
        self.array_size = array_size
        self.hunger = hunger
        self.reproduction = reproduction
        self.hunger_ticks = hunger_ticks
        self.reproduction_prey = reproduction_prey
        self.positions = {clan: [None] * array_size for clan in CLANS}
        self.tick_count = 0
        self._last_prey_tick = {clan: 0 for clan in CLANS}
        self._prey_kills = {clan: 0 for clan in CLANS}

    def start(self):
        total_needed = self.entities_per_clan * 3
        cells = self._random_cells(total_needed)

        index = 0
        for clan in CLANS:
            for entity_index in range(self.entities_per_clan):
                self.positions[clan][entity_index] = cells[index]
                index += 1
        self.tick_count = 0
        self._last_prey_tick = {clan: 0 for clan in CLANS}
        self._prey_kills = {clan: 0 for clan in CLANS}

    def _random_cells(self, count):
        prioritized_cells = []
        for x in range(self.width):
            for y in range(self.height):
                prioritized_cells.append((random.random(), (x, y)))

        prioritized_cells.sort()
        return [cell for _, cell in prioritized_cells[:count]]

    def step(self):
        new_positions = {clan: list(self.positions[clan]) for clan in CLANS}

        for clan in CLANS:
            self_arr = self.positions[clan]
            prey_arr = self.positions[PREY_OF[clan]]
            predator_arr = self.positions[PREDATOR_OF[clan]]
            directions = self.players[clan].play(
                list(self_arr), list(prey_arr), list(predator_arr)
            )

            for index, position in enumerate(self_arr):
                if position is None or not directions or index >= len(directions):
                    continue
                direction = directions[index]
                if not direction:
                    continue
                dx, dy = direction
                x, y = position
                new_positions[clan][index] = (
                    _clamp(x + _sign(dx), 0, self.width - 1),
                    _clamp(y + _sign(dy), 0, self.height - 1),
                )

        self._resolve_same_clan_overlaps(self.positions, new_positions)
        self.positions = new_positions
        self.tick_count += 1
        prey_kills = self._resolve_collisions()
        for clan, kills in prey_kills.items():
            if kills:
                self._last_prey_tick[clan] = self.tick_count
                self._prey_kills[clan] += kills

        self._apply_population_rules()

    def _resolve_same_clan_overlaps(self, old_positions, new_positions):
        """Assign every live entity a unique position."""
        for clan in CLANS:
            live_indices = [
                index for index, position in enumerate(old_positions[clan]) if position is not None
            ]
            old_cells = [old_positions[clan][index] for index in live_indices]
            if len(old_cells) != len(set(old_cells)):
                raise RuntimeError(f"{clan} has duplicate positions before movement")

            candidates = {}
            for index in live_indices:
                proposed = new_positions[clan][index]
                fallback = old_positions[clan][index]
                candidates[index] = [
                    cell for cell in (proposed, fallback) if cell is not None
                ]
                candidates[index] = list(dict.fromkeys(candidates[index]))

            cell_to_index = {}
            indices = list(live_indices)
            random.shuffle(indices)

            def match(index, visited):
                for cell in candidates[index]:
                    if cell in visited:
                        continue
                    visited.add(cell)
                    owner = cell_to_index.get(cell)
                    if owner is None or match(owner, visited):
                        cell_to_index[cell] = index
                        return True
                return False

            for index in indices:
                if not match(index, set()):
                    raise RuntimeError(f"Unable to resolve {clan} movement")

            resolved = [None] * len(new_positions[clan])
            for cell, index in cell_to_index.items():
                resolved[index] = cell
            new_positions[clan] = resolved

    def _resolve_collisions(self):
        occupancy: dict[Point, dict[str, list[int]]] = {}
        prey_kills = {clan: 0 for clan in CLANS}
        for clan in CLANS:
            for index, position in enumerate(self.positions[clan]):
                if position is not None:
                    occupancy.setdefault(position, {}).setdefault(clan, []).append(index)

        for clan_map in occupancy.values():
            clans_here = set(clan_map)
            if len(clans_here) == 3:
                for clan, indices in clan_map.items():
                    for index in indices:
                        self.positions[clan][index] = None
            elif len(clans_here) == 2:
                first, second = tuple(clans_here)
                predator, prey = (
                    (first, second) if PREY_OF[first] == second else (second, first)
                )
                for index in clan_map[prey]:
                    self.positions[prey][index] = None
                    prey_kills[predator] += 1
        return prey_kills

    def _apply_population_rules(self):
        if self.hunger:
            for clan in CLANS:
                if (
                    self.tick_count - self._last_prey_tick[clan] >= self.hunger_ticks
                ):
                    live_indices = [
                        index
                        for index, position in enumerate(self.positions[clan])
                        if position is not None
                    ]
                    if live_indices:
                        self.positions[clan][random.choice(live_indices)] = None
                    self._last_prey_tick[clan] = self.tick_count

        if self.reproduction:
            for clan in CLANS:
                while self._prey_kills[clan] >= self.reproduction_prey:
                    empty_index = next(
                        (
                            index
                            for index, position in enumerate(self.positions[clan])
                            if position is None
                        ),
                        None,
                    )
                    if empty_index is None:
                        break
                    position = self._random_free_cell()
                    if position is None:
                        break
                    self.positions[clan][empty_index] = position
                    self._prey_kills[clan] -= self.reproduction_prey

    def _random_free_cell(self):
        occupied = {
            position
            for positions in self.positions.values()
            for position in positions
            if position is not None
        }
        free_cells = [
            (x, y)
            for x in range(self.width)
            for y in range(self.height)
            if (x, y) not in occupied
        ]
        return random.choice(free_cells) if free_cells else None

    def alive_counts(self):
        return {
            clan: sum(position is not None for position in self.positions[clan])
            for clan in CLANS
        }

    def render(self):
        grid = [["." for _ in range(self.width)] for _ in range(self.height)]
        for clan in CLANS:
            for position in self.positions[clan]:
                if position is not None:
                    x, y = position
                    symbol = CLAN_SYMBOLS[clan]
                    grid[y][x] = f"{CLAN_COLORS[clan]}{symbol}{COLOR_RESET}"
        return "\n".join("".join(row) for row in grid)

    def is_over(self):
        return sum(count > 0 for count in self.alive_counts().values()) <= 1


class Server:
    """Wire three clients into a game and run it to completion."""

    def __init__(
        self,
        players,
        grid_size=(50, 50),
        entities_per_clan=25,
        max_ticks=1000,
        hunger=False,
        reproduction=False,
        hunger_ticks=10,
        reproduction_prey=3,
    ):
        self.game = Game(
            players,
            grid_size=grid_size,
            entities_per_clan=entities_per_clan,
            hunger=hunger,
            reproduction=reproduction,
            hunger_ticks=hunger_ticks,
            reproduction_prey=reproduction_prey,
        )
        self.max_ticks = max_ticks

    def run(self, verbose=False):
        self.game.start()
        history = [self.game.alive_counts()]

        for _ in range(self.max_ticks):
            self.game.step()
            counts = self.game.alive_counts()
            history.append(counts)
            if verbose:
                print(f"tick {self.game.tick_count}: {counts}")
                print(self.game.render())
                print()
                sleep(0.1)
            if self.game.is_over():
                break

        return history
