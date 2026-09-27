import colorsys
import inspect
import multiprocessing as mp
import os
import sys
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from heapq import nlargest
from itertools import combinations

import numpy as np
import pygame as pg

from .settings import GRIDSIZE, MAX_STEPS, SWARMS, SWARMSIZE


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


def clone_client(client):
    """New client, same constructor arguments.

    A batch reuses population instances across matches. Games that step
    together cannot share those instances: Gaussian keeps working buffers.
    """
    cls = type(client)
    kwargs = {}
    for name, param in inspect.signature(cls.__init__).parameters.items():
        if name == 'self' or param.kind in (param.VAR_POSITIONAL, param.VAR_KEYWORD):
            continue
        if hasattr(client, name):
            kwargs[name] = getattr(client, name)
    return cls(**kwargs)


def make_game(client_list, gridSize=GRIDSIZE, sizes=SWARMSIZE, colours=None, clone=False):
    if clone:
        client_list = [clone_client(client) for client in client_list]
    n = len(client_list)
    if isinstance(sizes, int):
        sizes = [sizes] * n
    if colours is None:
        colours = generate_colours(n)
    return Game(client_list, sizes, colours, gridSize)


def play_match(client_list, gridSize=GRIDSIZE, sizes=SWARMSIZE, colours=None, max_steps=MAX_STEPS):
    game = make_game(client_list, gridSize, sizes, colours)
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


class ParallelBatch:
    """Run a batch of matches across worker processes.

    Pass on_frame to draw the batch instead of running it headless. The
    jobs then step together, and the callback receives every game after
    each step, in job order. A finished match stays in that list and holds
    its last frame. Processes cannot draw into the window, so this path
    uses threads.
    """

    def __init__(self, population, workers=None, on_frame=None):
        self.population = population
        self.workers = workers or os.cpu_count() or 1
        self.on_frame = on_frame

    @staticmethod
    def _play(client_list):
        return play_match(client_list)

    def run(self, matches=None, swarms=SWARMS):
        if matches is None:
            if len(self.population) < swarms:
                raise ValueError(
                    f'need at least {swarms} clients to fill a match, '
                    f'population has {len(self.population)}'
                )
            matches = list(combinations(range(len(self.population)), swarms))

        jobs = [tuple(self.population[i] for i in match) for match in matches]
        if not jobs:
            return {'matches': [], 'scores': [0.0] * len(self.population)}

        if self.on_frame is not None:
            raw = self._run_visible(jobs)
        else:
            workers = max(1, min(self.workers, len(jobs)))
            if workers == 1 or len(jobs) == 1:
                raw = [ParallelBatch._play(job) for job in jobs]
            else:
                ctx = None if sys.platform == 'win32' else mp.get_context('fork')
                with ProcessPoolExecutor(max_workers=workers, mp_context=ctx) as pool:
                    raw = list(pool.map(ParallelBatch._play, jobs, chunksize=1))

        report, bags = [], [[] for _ in self.population]
        for match, trial in zip(matches, raw):
            rows = []
            for slot, cid in enumerate(match):
                row = trial[slot]
                bags[cid].append(row['score'])
                rows.append({'id': cid, **row})
            report.append(rows)

        scores = [sum(bag) / len(bag) if bag else 0.0 for bag in bags]
        return {'matches': report, 'scores': scores}

    def _run_visible(self, jobs):
        """Step every job together. Each game has its own copied clients."""
        games = [make_game(job, clone=True) for job in jobs]
        raw = [None] * len(jobs)
        active = [True] * len(jobs)
        steps = [0] * len(jobs)
        remaining = len(jobs)
        workers = max(1, min(self.workers, len(jobs)))
        pool = ThreadPoolExecutor(max_workers=workers) if workers > 1 else None
        try:
            self.on_frame(games)
            while remaining:
                order = [i for i in range(len(games)) if active[i]]
                if pool is None:
                    results = [games[i].step() for i in order]
                else:
                    futures = [pool.submit(games[i].step) for i in order]
                    results = [future.result() for future in futures]
                for i, result in zip(order, results):
                    steps[i] = steps[i] + 1
                    if result is not None or steps[i] >= MAX_STEPS:
                        raw[i] = games[i].metrics() if result is None else result
                        active[i] = False
                        remaining = remaining - 1
                self.on_frame(games)
        finally:
            if pool is not None:
                pool.shutdown(wait=True)
        return raw

    def fitness(self, results):
        return results['scores']

    def top(self, results, n=SWARMS):
        ids = nlargest(n, range(len(self.population)), key=results['scores'].__getitem__)
        return [self.population[i] for i in ids]
