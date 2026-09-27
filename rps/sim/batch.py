import multiprocessing as mp
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from heapq import nlargest
from itertools import combinations

from ..settings import SAMPLE, SWARMS
from .game import play_match


class ParallelBatch:
    """Run a batch of matches across worker processes."""

    def __init__(self, population, workers=None):
        self.population = population
        self.workers = workers or os.cpu_count() or 1

    @staticmethod
    def _play(client_list):
        return play_match(client_list)

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
            raw = [ParallelBatch._play(job) for job in jobs]
        else:
            ctx = None if sys.platform == 'win32' else mp.get_context('fork')
            with ProcessPoolExecutor(max_workers=workers, mp_context=ctx) as pool:
                raw = list(pool.map(ParallelBatch._play, jobs, chunksize=1))

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
