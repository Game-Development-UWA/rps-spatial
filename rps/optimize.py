"""Evolutionary loop for Gaussian genomes.

Optimizer.optimize scores each generation with a Swiss tournament, optionally
adapts the mutation sigma by the 1/5 rule, breeds lambda offspring, and replaces.
An individual is a genomes.csv row, collected by id. Fitness is the rung
reached on the tournament ladder.
"""

import inspect

import numpy as np

from . import clients, settings
from .catalog import PARAM_KEYS, Catalog
from .game import ParallelBatch


def bounds_for(key):
    """Inclusive range for one genome key. Cell is a whole number."""
    if key == 'cell':
        return settings.CELL
    if key.endswith('_sigma'):
        return settings.SIGMA
    return settings.WEIGHT


def sample_params(rng=None):
    rng = np.random.default_rng() if rng is None else rng
    params = {}
    for key in PARAM_KEYS:
        lo, hi = bounds_for(key)
        if key == 'cell':
            params[key] = int(rng.integers(lo, hi + 1))
        else:
            params[key] = float(rng.uniform(lo, hi))
    return params


def clip_params(params):
    out = dict(params)
    for key in PARAM_KEYS:
        if key not in out:
            continue
        lo, hi = bounds_for(key)
        if key == 'cell':
            out[key] = int(np.clip(int(out[key]), lo, hi))
        else:
            out[key] = float(np.clip(out[key], lo, hi))
    return out


def default_params():
    sig = inspect.signature(clients.Gaussian.__init__)
    params = {}
    for name, param in sig.parameters.items():
        if name in ('self', 'gridSize', 'visualize') or param.default is inspect.Parameter.empty:
            continue
        params[name] = param.default
    return clip_params(params)


class Optimizer:
    """One run: live population ids, champion archive, and the breeding knobs."""

    def __init__(self, catalog=None, mu=None, lam=None, replacement=None, crossover=None, adaptive=None, mutation_sigma=None, generations=None, rng=None, visualize=None, tick=None):
        self.catalog = Catalog() if catalog is None else catalog
        self.mu = settings.MU if mu is None else mu
        self.lam = settings.LAMBDA if lam is None else lam
        self.keep_parents = settings.REPLACEMENT if replacement is None else replacement if isinstance(replacement, bool) else False
        self.use_crossover = settings.CROSSOVER if crossover is None else crossover
        self.adapt_mutation = settings.ADAPTIVE_MUTATION if adaptive is None else adaptive
        self.mutation_sigma = settings.MUTATION_SIGMA if mutation_sigma is None else mutation_sigma
        self.generations = settings.GENERATIONS if generations is None else generations
        self.rng = np.random.default_rng() if rng is None else rng
        self.visualize = visualize
        self.tick = tick
        self.population = []
        self.archive = []
        self.parent_score = {}

    def optimize(self, generations=None):
        """Score, adapt, breed, and replace for the whole run. Returns live ids."""
        generations = self.generations if generations is None else generations
        self.population = []
        self.archive = []
        self.parent_score = {}
        for _ in range(generations):
            self.step()
        return self.population

    def step(self):
        """One generation. Returns the scores of the individuals who just played."""
        if not self.population:
            self.population = self.initial_population()
        scores, parents = self.selection()
        if self.adapt_mutation:
            self.mutation_sigma = self.adapt_mutation_sigma(scores)
        offspring = self.breed(parents, scores)
        self.replace(parents, offspring)
        return scores

    def initial_population(self):
        """Lambda genomes when parents are dropped, mu + lambda when they are kept."""
        count = self.mu + self.lam if self.keep_parents else self.lam
        population = []
        for _ in range(count):
            gid = self.catalog.add_genome('Gaussian', sample_params(self.rng), visible=0)
            population.append(gid)
        return population

    def selection(self):
        """Score the live population and return those scores with the mu parents.

        Draw m archive members who are not already live, and draw none until at least m such champions exist.
        The pool is the live population plus those champions, each id once.
        Afterwards, keep the best live individuals who are not already archived.
        Parents are the mu highest rungs of the live population. A tie keeps the earlier ladder seat.
        """
        m = settings.CHAMPION_SAMPLE
        seated = set(self.population)
        outsiders = []
        for gid in self.archive:
            if gid in seated:
                continue
            outsiders.append(gid)
            seated.add(gid)
        if m <= 0 or len(outsiders) < m:
            champions = []
        else:
            chosen_indexes = self.rng.choice(len(outsiders), m, replace=False)
            champions = [int(outsiders[idx]) for idx in chosen_indexes]

        pool = list(self.population) + champions

        scores, ladder = Tournament(self.catalog, pool, self.rng, self.visualize, self.tick).run()
        place = {gid: index for index, gid in enumerate(ladder)}

        blocked = set(self.archive)
        ranked = sorted(self.population, key=lambda gid: (-scores[gid], place[gid]))
        to_add = [gid for gid in ranked if gid not in blocked][:settings.ARCHIVE_TOP]
        self.archive.extend(to_add)
        parents = ranked[:self.mu]

        return scores, parents

    def adapt_mutation_sigma(self, scores):
        """1/5 rule. Raise the mutation sigma when more than a fifth of judged offspring improved."""
        judged = []
        for gid in self.population:
            if gid in self.parent_score:
                judged.append(gid)
        if len(judged) == 0:
            return self.mutation_sigma
        successes = 0
        for gid in judged:
            if scores[gid] > self.parent_score[gid]:
                successes = successes + 1
        rate = successes / len(judged)
        sigma = self.mutation_sigma * settings.SIGMA_ADAPT if rate > 1 / 5 else self.mutation_sigma / settings.SIGMA_ADAPT if rate < 1 / 5 else self.mutation_sigma
        sigma = 0.0001 if sigma < 0.0001 else 1.0 if sigma > 1.0 else sigma
        return sigma

    def breed(self, parents, scores):
        """Lambda offspring. Each child remembers the better parent's score.

        With crossover, that parent is the better of the two. Without it, the child is a mutation of one parent.
        """
        offspring = []
        while len(offspring) < self.lam:
            parent_a = parents[int(self.rng.integers(0, len(parents)))]
            if self.use_crossover:
                parent_b = parents[int(self.rng.integers(0, len(parents)))]
                genome = self.crossover(parent_a, parent_b)
                better = scores[parent_a] if scores[parent_a] > scores[parent_b] else scores[parent_b]
            else:
                genome = self.catalog.genome(parent_a)
                better = scores[parent_a]
            gid = self.catalog.add_genome('Gaussian', self.mutate(genome), visible=0)
            self.parent_score[gid] = better
            offspring.append(gid)
        return offspring

    def mutate(self, genome):
        """Per gene: redraw it from its range, or else add a normal draw with this standard deviation."""
        genome = dict(genome)
        for key in PARAM_KEYS:
            lo, hi = bounds_for(key)
            if self.rng.random() < settings.P_PERTURB:
                genome[key] = int(self.rng.integers(lo, hi + 1)) if key == 'cell' else float(self.rng.uniform(lo, hi))
            elif self.rng.random() < settings.P_MUTATE:
                updated = float(genome[key]) + float(self.rng.normal(0.0, self.mutation_sigma * (hi - lo)))
                genome[key] = int(round(updated)) if key == 'cell' else updated
        return clip_params(genome)

    def crossover(self, parent_a, parent_b):
        """Linear recombination. Each gene draws its own blend from parent A toward parent B."""
        genome_a = self.catalog.genome(parent_a)
        genome_b = self.catalog.genome(parent_b)
        lo, hi = settings.RECOMB_ALPHA
        genome = {}
        for key in PARAM_KEYS:
            alpha = float(self.rng.uniform(lo, hi))
            value = float(genome_a[key]) + alpha * (float(genome_b[key]) - float(genome_a[key]))
            genome[key] = int(round(value)) if key == 'cell' else value
        return clip_params(genome)

    def replace(self, parents, offspring):
        """True keeps the mu parents and the offspring. False keeps the offspring only."""
        self.population = list(parents) + list(offspring) if self.keep_parents else list(offspring)


class Tournament:
    """Swiss ladder over one population of genome ids.

    Fitness is the sum of placement points. That sum is the rung reached.
    """

    def __init__(self, catalog, population, rng, visualize=None, tick=None):
        self.catalog = catalog
        self.population = population
        self.rng = rng
        self.visualize = visualize
        self.tick = tick

    def run(self):
        """Seat each round from the ladder, then add the placement points from that match."""
        n = settings.SWARMS
        if len(self.population) % n != 0:
            raise ValueError('tournament population must be divisible by ' + str(n) + ', got ' + str(len(self.population)))

        batch = ParallelBatch(
            [self.client(gid) for gid in self.population],
            on_frame=self.visualize,
            tick=self.tick,
        )
        points = {gid: 0.0 for gid in self.population}
        ladder = list(self.population)
        self.rng.shuffle(ladder)
        for round_number in range(1, settings.TOURNAMENT_ROUNDS + 1):
            if round_number > 1:
                ladder.sort(key=lambda gid: points[gid], reverse=True)
            for rows in batch.run(self.pair(ladder))['matches']:
                awarded = self.placement([row['score'] for row in rows])
                for index in range(len(rows)):
                    gid = self.population[rows[index]['id']]
                    points[gid] = points[gid] + awarded[index]
        ladder.sort(key=lambda gid: points[gid], reverse=True)
        return {gid: points[gid] for gid in ladder}, ladder

    def pair(self, ladder):
        """Disjoint matches for one round, so the batch can run them together.

        The ladder is already ordered. Each match is shuffled so color slots are not fixed.
        """
        n = settings.SWARMS
        index = {gid: i for i, gid in enumerate(self.population)}
        matches = []
        for start in range(0, len(ladder), n):
            seated = list(ladder[start:start + n])
            self.rng.shuffle(seated)
            matches.append(tuple(index[gid] for gid in seated))
        return matches

    def client(self, gid):
        return clients.Gaussian(gridSize=settings.GRIDSIZE, **self.catalog.genome(gid))

    def placement(self, raw_scores):
        """Points for finishing order. First gets n - 1. A tie splits the places it covers."""
        scores = []
        for score in raw_scores:
            scores.append(float(score))
        n = len(scores)
        order = sorted(range(n), key=lambda i: scores[i], reverse=True)
        points = [0.0] * n
        start = 0
        while start < n:
            end = start + 1
            while end < n and scores[order[end]] == scores[order[start]]:
                end = end + 1
            share = 0.0
            for place in range(start, end):
                share = share + (n - 1 - place)
            share = share / (end - start)
            for place in range(start, end):
                points[order[place]] = share
            start = end
        return points
