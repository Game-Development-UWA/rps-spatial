import numpy as np

from .. import clients
from ..sim.game import generate_colours, play_match
from .gaussian import candidate_dots, mutate_gaussian_params, sample_gaussian_params
from ..settings import MAX_STEPS, SWARMSIZE


class Train:
    """Evolve Gaussian genomes inside the settings.py search box."""

    def __init__(self, gridSize, pop_size=9, generations=8):
        if pop_size < 3 or pop_size % 2 == 0:
            raise ValueError('train population must be odd and >= 3')
        self.gridSize = gridSize
        self.generations = generations
        self.population = [sample_gaussian_params() for _ in range(pop_size)]
        self.scores = [0.0] * pop_size
        self.generation = 0
        self.done = False

    def candidates(self):
        colours = generate_colours(len(self.population))
        ranked = np.argsort(self.scores)[::-1]
        return [
            {'colour': colours[i], 'dots': candidate_dots(self.population[i]), 'score': self.scores[i]}
            for i in ranked
        ]

    def best(self):
        return self.population[int(np.argmax(self.scores))]

    def step(self):
        instances = [
            clients.Gaussian(gridSize=self.gridSize, **params)
            for params in self.population
        ]
        rows = play_match(
            instances,
            gridSize=self.gridSize,
            sizes=min(SWARMSIZE, 400),
            max_steps=MAX_STEPS,
        )
        self.scores = [float(row['score']) for row in rows]
        self.generation += 1
        if self.generation >= self.generations:
            self.done = True
            return self.candidates()
        elite_n = max(1, len(self.population) // 3)
        order = np.argsort(self.scores)[::-1]
        elites = [self.population[i] for i in order[:elite_n]]
        next_pop = [dict(p) for p in elites]
        rng = np.random.default_rng()
        while len(next_pop) < len(self.population):
            parent = elites[int(rng.integers(0, len(elites)))]
            next_pop.append(mutate_gaussian_params(parent, rng))
        self.population = next_pop
        return self.candidates()
