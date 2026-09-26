import colorsys

import numpy as np
import pygame as pg

from ..settings import GRIDSIZE, MAX_STEPS, SWARMSIZE


def legal_match_count(n):
    return n >= 3 and n % 2 == 1


def generate_colours(n, saturation=0.75, value=0.85):
    return [
        tuple(round(c * 255) for c in colorsys.hsv_to_rgb(i / n, saturation, value))
        for i in range(n)
    ]


def gather(swarms, indices):
    """One (N, 2) array of every unit in `indices`. Clients take a single enemy
    array, so the k prey (or k predators) are concatenated into one."""
    parts = [swarms[i].positions for i in indices if swarms[i].positions.size]
    if not parts:
        return np.empty((0, 2), dtype=int)
    return parts[0] if len(parts) == 1 else np.concatenate(parts)


def play_match(client_list, gridSize=GRIDSIZE, sizes=SWARMSIZE, colours=None, max_steps=MAX_STEPS):
    n = len(client_list)
    if isinstance(sizes, int):
        sizes = [sizes] * n
    if colours is None:
        colours = generate_colours(n)
    game = Game(client_list, sizes, colours, gridSize)
    for _ in range(max_steps):
        result = game.step()
        if result is not None:
            return result
    return game.metrics()


class Swarm:
    def __init__(self, population, gridSize, client, colour):
        flat = np.random.choice(gridSize[0] * gridSize[1], size=population, replace=False)
        xs = flat % gridSize[0]
        ys = flat // gridSize[0]
        self.gridSize = np.array(gridSize)
        self.positions = np.column_stack((xs, ys))
        self.velocities = np.zeros((population, 2), dtype=int)
        self.client = client
        self.colour = np.asarray(colour, dtype=np.uint8)
        self.kills = 0
        self._cell_to_agent = np.full(gridSize[0] * gridSize[1], -1, dtype=np.int32)

    def getResponse(self, preyposes, predposes):
        if self.positions.size == 0:
            return
        if preyposes.size == 0 and predposes.size == 0:
            self.velocities = np.zeros_like(self.velocities)
            return
        self.velocities = self.client.getResponse(self.positions, preyposes, predposes)

    def step(self):
        if self.positions.size == 0:
            return

        width, height = self.gridSize
        targets = self.positions + self.velocities
        total_cells = width * height

        oob_mask = (
            (targets[:, 0] < 0) | (targets[:, 0] >= width) |
            (targets[:, 1] < 0) | (targets[:, 1] >= height)
        )

        flat_pos = self.positions[:, 1] * width + self.positions[:, 0]
        flat_targets = targets[:, 1] * width + targets[:, 0]
        valid_targets = np.where(oob_mask, -1, flat_targets)
        counts = np.bincount(valid_targets[valid_targets >= 0], minlength=total_cells)

        contention_mask = np.zeros(len(self.positions), dtype=bool)
        valid_indices = np.where(~oob_mask)[0]
        contention_mask[valid_indices] = counts[valid_targets[valid_indices]] > 1
        blocked_mask = oob_mask | contention_mask

        valid_agents = np.where(~blocked_mask)[0]
        valid_flat_targets = flat_targets[valid_agents]
        self._cell_to_agent[valid_flat_targets] = valid_agents

        queue = [flat_pos[i] for i in np.where(blocked_mask)[0]]
        while queue:
            blocked_cell = queue.pop()
            agent_id = self._cell_to_agent[blocked_cell]
            if agent_id != -1:
                self._cell_to_agent[blocked_cell] = -1
                blocked_mask[agent_id] = True
                queue.append(flat_pos[agent_id])

        self._cell_to_agent[valid_flat_targets] = -1
        self.positions = np.where(blocked_mask[:, None], self.positions, targets)
        self.velocities[blocked_mask] = 0

    def draw(self, grid):
        xs, ys = self.positions[:, 0], self.positions[:, 1]
        grid[xs, ys] = self.colour


class Game:
    def __init__(self, clients, sizes, colours, gridSize):
        n = len(clients)
        if not legal_match_count(n):
            raise ValueError(
                f'generalised RPS needs an odd number of swarms >= 3, got {n}. '
                'An even count makes i and i + n/2 beat each other, so the '
                'relation stops being a tournament.'
            )
        self.gridSize = gridSize
        self.k = (n - 1) // 2
        self.swarms = [Swarm(size, gridSize, client, colour) for client, size, colour in zip(clients, sizes, colours)]
        self.n = len(self.swarms)
        self.prey_of = [[(i - d) % n for d in range(1, self.k + 1)] for i in range(n)]
        self.pred_of = [[(i + d) % n for d in range(1, self.k + 1)] for i in range(n)]
        self._grid_occupied = np.zeros(gridSize[0] * gridSize[1], dtype=bool)

    def step(self):
        for i, swarm in enumerate(self.swarms):
            swarm.getResponse(
                gather(self.swarms, self.prey_of[i]),
                gather(self.swarms, self.pred_of[i]),
            )
        for swarm in self.swarms:
            swarm.step()

        keys = [
            swarm.positions[:, 1] * self.gridSize[0] + swarm.positions[:, 0]
            if swarm.positions.size else np.empty(0, dtype=int)
            for swarm in self.swarms
        ]

        dead = [np.zeros(len(key), dtype=bool) for key in keys]

        for d in range(1, self.k + 1):
            for i in range(self.n):
                j = (i - d) % self.n
                if keys[i].size == 0 or keys[j].size == 0:
                    continue
                self._grid_occupied[keys[i]] = True
                eats = self._grid_occupied[keys[j]] & ~dead[j]
                self.swarms[i].kills += int(eats.sum())
                dead[j] |= eats
                self._grid_occupied[keys[i]] = False

        for swarm, mask in zip(self.swarms, dead):
            if mask.any():
                swarm.positions = swarm.positions[~mask]
                swarm.velocities = swarm.velocities[~mask]

        living = sum(1 for swarm in self.swarms if swarm.positions.size > 0)
        if living <= 2:
            return self.metrics()

    def draw(self, content):
        arr = pg.surfarray.pixels3d(content)
        for swarm in self.swarms:
            swarm.draw(arr)

    def metrics(self):
        n = len(self.swarms)
        results = []
        for i, swarm in enumerate(self.swarms):
            living = 0 if swarm.positions.size == 0 else len(swarm.positions)
            prey_surviving = sum(
                len(self.swarms[(i - d) % n].positions) for d in range(1, self.k + 1)
            )
            results.append({
                'swarm': i,
                'living': living,
                'prey_surviving': prey_surviving,
                'kills': swarm.kills,
                'score': living - prey_surviving,
            })
        return results
