import colorsys
import multiprocessing as mp
import pygame as pg
import os
import sys
import clients
from concurrent.futures import ProcessPoolExecutor
from heapq import nlargest
from itertools import combinations

import numpy as np

from settings import *
from clients import *

def generate_colours(n, saturation=0.75, value=0.85):
    return [
        tuple(round(c * 255) for c in colorsys.hsv_to_rgb(i / n, saturation, value))
        for i in range(n)
    ]


def colour_text(text, rgb):
    r, g, b = (int(c) for c in rgb[:3])
    return f'\033[38;2;{r};{g};{b}m{text}\033[0m'


def gather(swarms, indices):
    """One (N, 2) array of every unit in `indices`. Clients take a single enemy
    array, so the k prey (or k predators) are concatenated into one."""
    parts = [swarms[i].positions for i in indices if swarms[i].positions.size]
    if not parts:
        return np.empty((0, 2), dtype=int)
    # the single-part fast path keeps k = 1 allocating exactly as it did before
    return parts[0] if len(parts) == 1 else np.concatenate(parts)


def print_match(rows, population, title=None, colours=None):
    if title:
        print(title)
    if colours is None:
        colours = generate_colours(len(rows))
    for i, row in enumerate(rows):
        client_id = row['id'] if 'id' in row else int(row['swarm'])
        line = (
            f"  id {client_id} {population[client_id]}: "
            f"living={row['living']:.2f} "
            f"prey_surviving={row['prey_surviving']:.2f} "
            f"kills={row['kills']:.1f} "
            f"score={row['score']:.2f}"
        )
        print(colour_text(line, colours[i]))


def print_scores(population, scores, title='final scores'):
    print(title)
    colours = generate_colours(len(population))
    for i, score in enumerate(scores):
        line = f'  id {i} {population[i]}: score={score:.2f}'
        print(colour_text(line, colours[i]))


class Swarm:
    def __init__(self, population, gridSize, client, colour):
        flat = np.random.choice(gridSize[0] * gridSize[1], size=population, replace=False)
        xs = flat % gridSize[1]
        ys = flat // gridSize[1]
        self.gridSize = gridSize
        self.positions = np.column_stack((xs, ys))
        self.velocities = np.zeros((population, 2), dtype=int)
        self.client = client
        self.colour = np.asarray(colour, dtype=np.uint8)
        self.kills = 0

    def getResponse(self, preyposes, predposes):
        if self.positions.size == 0:
            return
        if preyposes.size == 0 and predposes.size == 0:
            # no prey and no predators left: nothing to chase or flee.
            # A single empty side is the client's business -- they contribute
            # only the term they have units for.
            self.velocities = np.zeros_like(self.velocities)
            return
        self.velocities = self.client.getResponse(self.positions, preyposes, predposes)

    def step(self):
        if self.positions.size == 0:
            return

        self.positions += self.velocities

        while True:
            mask = (np.clip(self.positions, 0, self.gridSize[0] - 1) != self.positions)
            self.positions -= self.velocities * mask
            self.velocities *= 1 - mask
        
            flat_positions = self.positions[:, 1] * self.gridSize[0] + self.positions[:, 0]
            _, inverse, counts = np.unique(flat_positions, return_inverse=True, return_counts=True)
        
            if not np.any(counts > 1):
                break
        
            mask = (counts[inverse] > 1).astype(int).reshape(-1, 1)
        
            self.positions -= self.velocities * mask
            self.velocities *= 1 - mask

    def draw(self, grid):
        xs, ys = self.positions[:, 0], self.positions[:, 1]
        grid[xs, ys] = self.colour

class Gui:
    def __init__(self):
        pg.init()
        self.screen = pg.display.set_mode(WINDOWSIZE, pg.RESIZABLE)
        pg.display.set_caption("Rock Paper Scissors Simulation")
        self.clock = pg.time.Clock()
        self.grid = pg.Surface(GRIDSIZE)
        self.gridWidth, self.gridHeight = GRIDSIZE
        self.width, self.height = WINDOWSIZE
        self.margin = MARGIN * 2
        self.stepTime = (1 / SPS if SPS else 0)

    def run(self):
        accumulator = 0
        running = True
        game = Game([clients.Gaussian((self.gridWidth, self.gridHeight)), clients.Gaussian((self.gridWidth, self.gridHeight)), clients.Gaussian((self.gridWidth, self.gridHeight))], [100000, 100000, 100000], generate_colours(3), (self.gridWidth, self.gridHeight))
        while running:
            for event in pg.event.get():
                if event.type == pg.QUIT:
                    running = False

                elif event.type == pg.VIDEORESIZE:
                    self.width, self.height = event.w, event.h

            deltatime = self.clock.tick(0) / 1000
            accumulator += deltatime

            if accumulator >= self.stepTime:
                game.step()
                self.screen.fill(pg.color.Color(70, 70, 70))
                self.grid.fill("Black")
                game.draw(pg.surfarray.pixels3d(self.grid))
                self.drawGrid()

                accumulator -= self.stepTime

            pg.display.flip()

    def drawGrid(self):
        width, height = min(self.width - self.margin, self.gridWidth * (self.height - self.margin) / self.gridHeight), min(self.gridHeight * (self.width - self.margin) / self.gridWidth, self.height - self.margin)
        self.screen.blit(pg.transform.scale(self.grid, (width, height)), (self.margin + (self.width - self.margin * 2 - width) // 2, self.margin + (self.height - self.margin * 2 - height) // 2))
        

class Game:
    def __init__(self, clients, sizes, colours, gridSize):
        n = len(clients)
        if n < 3 or n % 2 == 0:
            raise ValueError(
                f'generalised RPS needs an odd number of swarms >= 3, got {n}. '
                'An even count makes i and i + n/2 beat each other, so the '
                'relation stops being a tournament.'
            )
        # each swarm eats the k below it on the cycle and is eaten by the k above
        self.gridSize = gridSize
        self.k = (n - 1) // 2
        self.swarms = [Swarm(size, gridSize, client, colour) for client, size, colour in zip(clients, sizes, colours)]
        self.n = len(self.swarms)
        self.prey_of = [[(i - d) % n for d in range(1, self.k + 1)] for i in range(n)]
        self.pred_of = [[(i + d) % n for d in range(1, self.k + 1)] for i in range(n)]

    def step(self):

        # Update Swarm Positions
        for i, swarm in enumerate(self.swarms):
            swarm.getResponse(
                gather(self.swarms, self.prey_of[i]),
                gather(self.swarms, self.pred_of[i]),
            )
        for swarm in self.swarms:
            swarm.step()

        # Standard elimination
        # 1. Snapshot the board
        keys = [
            swarm.positions[:, 1] * self.gridSize[0] + swarm.positions[:, 0]
            if swarm.positions.size else np.empty(0, dtype=int)
            for swarm in self.swarms
        ]

        dead = [np.zeros(len(key), dtype=bool) for key in keys]

        # 2. Resolve every pairing against the snapshot, i eats j.
        #    the nearest-in-cycle predator claims a shared victim.
        for d in range(1, self.k + 1):
            for i in range(self.n):
                j = (i - d) % self.n
                if keys[i].size == 0 or keys[j].size == 0:
                    continue
                eats = np.isin(keys[j], keys[i]) & ~dead[j]
                self.swarms[i].kills += int(eats.sum())
                dead[j] |= eats

        # 3. Apply deletions only once every pairing is resolved
        for swarm, mask in zip(self.swarms, dead):
            if mask.any():
                swarm.positions = swarm.positions[~mask]
                swarm.velocities = swarm.velocities[~mask]

        living = sum(1 for swarm in self.swarms if swarm.positions.size > 0)
        if living <= 2:
            return self.metrics()

    def draw(self, grid):
        for swarm in self.swarms:
            swarm.draw(grid)

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

    def print(self, results=None):
        print_match(
            results or self.metrics(),
            [swarm.client for swarm in self.swarms],
            colours=[swarm.colour for swarm in self.swarms],
        )


class Tournament:
    def __init__(self, population, workers=None):
        self.population = population
        self.workers = workers or os.cpu_count() or 1

    @staticmethod
    def _play(clients):
        return Game(clients).step()

    def run(self, matches=None, sample=SAMPLE, swarms=SWARMS):
        if matches is None:
            if len(self.population) < swarms:
                raise ValueError(
                    f'need at least {swarms} clients to fill a match, '
                    f'population has {len(self.population)}'
                )
            matches = list(combinations(range(len(self.population)), swarms))

        jobs = [tuple(self.population[i] for i in match) for match in matches for _ in range(sample)]
        if not jobs:
            return {'matches': [], 'scores': [0.0] * len(self.population)}

        workers = max(1, min(self.workers, len(jobs)))
        if workers == 1 or len(jobs) == 1:
            raw = [Tournament._play(job) for job in jobs]
        else:
            # fork copies the already-imported numpy/scipy runtime; spawn
            # would re-import in every worker and dominate small tournaments.
            ctx = None if sys.platform == 'win32' else mp.get_context('fork')
            with ProcessPoolExecutor(max_workers=workers, mp_context=ctx) as pool:
                raw = list(pool.map(Tournament._play, jobs, chunksize=1))


        report, bags = [], [[] for _ in self.population]
        for i, match in enumerate(matches):
            chunk = raw[i * sample:(i + 1) * sample]
            rows = []
            for slot, cid in enumerate(match):
                samples = [trial[slot] for trial in chunk]
                avg = {
                    key: sum(row[key] for row in samples) / len(samples)
                    for key in samples[0]
                }
                bags[cid].append(avg['score'])
                rows.append({'id': cid, **avg})
            report.append(rows)

        scores = [sum(bag) / len(bag) if bag else 0.0 for bag in bags]
        return {'matches': report, 'scores': scores}

    def fitness(self, results):
        return results['scores']

    def top(self, results, n=SWARMS):
        ids = nlargest(n, range(len(self.population)), key=results['scores'].__getitem__)
        return [self.population[i] for i in ids]

    def print(self, results):
        for i, rows in enumerate(results['matches']):
            print_match(rows, self.population, f'match {i}')
        print_scores(self.population, results['scores'])
