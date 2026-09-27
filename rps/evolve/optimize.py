"""Evolutionary loop for Gaussian genomes.

Optimizer.optimize scores each generation with a Swiss tournament, adapts the
mutation sigma by the 1/5 rule, breeds lambda offspring, and replaces.
An individual is a genomes.csv row, collected by id. Fitness is the
aggregated match score.
"""

import inspect

import numpy as np

from .. import clients, settings
from ..catalog import PARAM_KEYS, Catalog
from ..sim.batch import ParallelBatch


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

    def __init__(self, catalog=None, mu=None, lam=None, replacement=None, crossover=None, mutation_sigma=None, generations=None, rng=None):
        self.catalog = Catalog() if catalog is None else catalog
        self.mu = settings.MU if mu is None else mu
        self.lam = settings.LAMBDA if lam is None else lam
        self.keep_parents = settings.REPLACEMENT if replacement is None else replacement if isinstance(replacement, bool) else False
        self.use_crossover = settings.CROSSOVER if crossover is None else crossover
        self.mutation_sigma = settings.MUTATION_SIGMA if mutation_sigma is None else mutation_sigma
        self.generations = settings.GENERATIONS if generations is None else generations
        self.rng = np.random.default_rng() if rng is None else rng
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
        scores = self.selection()
        self.mutation_sigma = self.adapt_mutation_sigma(scores)
        parents = self.choose_parents(scores)
        offspring = self.breed(parents, scores)
        self.replace(parents, offspring)
        return scores

    def selection(self):
        return Tournament(self.catalog, self.population, self.archive, self.rng).run()

    def initial_population(self):
        """Lambda genomes when parents are dropped, mu + lambda when they are kept."""
        count = self.mu + self.lam if self.keep_parents else self.lam
        population = []
        for _ in range(count):
            gid = self.catalog.add_genome('Gaussian', sample_params(self.rng), visible=0)
            population.append(gid)
        return population

    def choose_parents(self, scores):
        """The mu highest-scoring members of the live population."""
        def score_of(gid):
            return scores[gid]

        ranked = sorted(self.population, key=score_of, reverse=True)
        return ranked[:self.mu]

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

    def replace(self, parents, offspring):
        """True keeps the mu parents and the offspring. False keeps the offspring only."""
        self.population = list(parents) + list(offspring) if self.keep_parents else list(offspring)

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

    def mutate(self, genome):
        """Per gene: redraw it from its range, or else nudge it by the mutation sigma."""
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
        """Linear recombination: the mean of the two parent genomes."""
        genome_a = self.catalog.genome(parent_a)
        genome_b = self.catalog.genome(parent_b)
        genome = {}
        for key in PARAM_KEYS:
            value = (float(genome_a[key]) + float(genome_b[key])) / 2
            genome[key] = int(round(value)) if key == 'cell' else value
        return clip_params(genome)


class Tournament:
    """Swiss tournament. Pool members are genome ids."""

    def __init__(self, catalog, population, archive, rng, m=None):
        self.catalog = catalog
        self.population = population
        self.archive = archive
        self.rng = rng
        self.m = settings.CHAMPION_SAMPLE if m is None else m

    def run(self):
        """Pair a round, run it as one batch, then pair the next round from those scores."""

        def sample_champions():
            """Draw m archive members once. A short archive contributes everyone it has."""
            if self.m <= 0 or not self.archive:
                return []
            if len(self.archive) <= self.m:
                return list(self.archive)
            return [int(gid) for gid in self.rng.choice(self.archive, self.m, replace=False)]

        def assemble_pool(champions):
            """Live population plus sampled champions, each id once."""
            pool = []
            seen = set()
            for gid in [*self.population, *champions]:
                if gid not in seen:
                    seen.add(gid)
                    pool.append(gid)
            return pool

        champions = sample_champions()
        pool = assemble_pool(champions)
        n = settings.SWARMS
        if len(pool) % n != 0:
            raise ValueError('tournament pool must be divisible by ' + str(n) + ', got ' + str(len(pool)))

        batch = ParallelBatch([self.client(gid) for gid in pool])
        standings = {gid: [] for gid in pool}
        for round_number in range(1, settings.TOURNAMENT_ROUNDS + 1):
            matches = self.pair(pool, standings, round_number)
            for rows in batch.run(matches)['matches']:
                norm_scores = self.normalize([row['score'] for row in rows])
                for index in range(len(rows)):
                    standings[pool[rows[index]['id']]].append(norm_scores[index])

        scores = {gid: self.fitness(standings[gid]) for gid in pool}
        self.update_archive(scores, champions)
        return scores

    def pair(self, pool, standings, round_number):
        """Disjoint matches for one round, so the batch can run them together.

        Round 1 is random. Later rounds sort by the scores collected so far.
        Each match is shuffled so color slots are not fixed.
        """
        ordering = list(pool)
        if round_number == 1:
            self.rng.shuffle(ordering)
        else:
            ordering.sort(key=lambda gid: sum(standings[gid]), reverse=True)
        n = settings.SWARMS
        index = {gid: i for i, gid in enumerate(pool)}
        matches = []
        for start in range(0, len(ordering), n):
            seated = ordering[start:start + n]
            self.rng.shuffle(seated)
            matches.append(tuple(index[gid] for gid in seated))
        return matches

    def client(self, gid):
        return clients.Gaussian(gridSize=settings.GRIDSIZE, **self.catalog.genome(gid))

    def normalize(self, raw_scores, method=None):
        """Rescale one match. A flat match becomes zeros."""
        method = settings.NORMALIZATION if method is None else method
        scores = []
        for score in raw_scores:
            scores.append(float(score))
        if method == 'min-max':
            lo = min(scores)
            hi = max(scores)
            if hi == lo:
                return [0.0] * len(scores)
            scaled = []
            for score in scores:
                scaled.append((score - lo) / (hi - lo))
            return scaled
        if method == 'z-score':
            center = self.mean_of(scores)
            spread = self.spread_of(scores, center)
            if spread == 0.0:
                return [0.0] * len(scores)
            scaled = []
            for score in scores:
                scaled.append((score - center) / spread)
            return scaled
        raise ValueError('normalization must be min-max or z-score, got ' + repr(method))

    def mean_of(self, scores):
        total = 0.0
        for score in scores:
            total = total + score
        return total / len(scores)

    def spread_of(self, scores, center):
        total = 0.0
        for score in scores:
            diff = score - center
            total = total + diff * diff
        return (total / len(scores)) ** 0.5

    def fitness(self, round_scores, method=None):
        """Sum or average the normalized scores from the rounds an individual played."""
        method = settings.AGGREGATION if method is None else method
        if len(round_scores) == 0:
            return 0.0
        total = 0.0
        for score in round_scores:
            total = total + score
        if method != 'sum' and method != 'average':
            raise ValueError('aggregation must be sum or average, got ' + repr(method))
        return total if method == 'sum' else total / len(round_scores)

    def update_archive(self, scores, champions):
        """Keep the best live individuals who are not already in the archive or this sample."""
        blocked = set()
        for gid in self.archive:
            blocked.add(gid)
        for gid in champions:
            blocked.add(gid)

        def score_of(gid):
            return scores[gid]

        ranked = sorted(self.population, key=score_of, reverse=True)
        added = 0
        for gid in ranked:
            if added >= settings.ARCHIVE_TOP:
                return
            if gid in blocked:
                continue
            self.archive.append(gid)
            blocked.add(gid)
            added = added + 1
