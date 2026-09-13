import colorsys
import os
from concurrent.futures import ProcessPoolExecutor
from heapq import nlargest
from itertools import combinations

import numpy as np

from settings import *


def generate_colours(n, saturation=0.75, value=0.85):
  return [
    tuple(round(c * 255) for c in colorsys.hsv_to_rgb(i / n, saturation, value))
    for i in range(n)
  ]


def print_match(rows, population, title=None):
  if title:
    print(title)
  for row in rows:
    client_id = row['id'] if 'id' in row else int(row['swarm'])
    print(
      f"  id {client_id} {population[client_id]}: "
      f"living={row['living']:.2f} "
      f"prey_surviving={row['prey_surviving']:.2f} "
      f"score={row['score']:.2f}"
    )


def print_scores(population, scores, title='final scores'):
  print(title)
  for i, score in enumerate(scores):
    print(f'  id {i} {population[i]}: score={score:.2f}')


class Game:
  def __init__(self, clients, gui=True):
    colours = generate_colours(len(clients))
    self.swarms = [Swarm(SWARMSIZE, client, colour) for client, colour in zip(clients, colours)]
    self.gui = gui
    self.pg = None
    self.screen = None
    self.clock = None
    self.grid = None

    if gui:
      import pygame as pg
      self.pg = pg
      pg.init()
      self.screen = pg.display.set_mode(WINDOWSIZE)
      pg.display.set_caption("Rock Paper Scissors Simulation")
      self.clock = pg.time.Clock()
      self.grid = pg.Surface((GRIDSIZE, GRIDSIZE))

  def run(self):
    n = len(self.swarms)
    running = True
    step = 0
    while running:
      if self.gui:
        for event in self.pg.event.get():
          if event.type == self.pg.QUIT:
            running = False
        self.screen.fill(BACKGROUND)
        self.grid.fill(BACKGROUND)
        pixels = self.pg.surfarray.pixels3d(self.grid)
      
      # Update Swarm Positions
      for i, swarm in enumerate(self.swarms):
        swarm.getResponse(self.swarms[i - 1].positions, self.swarms[(i + 1) % n].positions)
      for swarm in self.swarms:
        swarm.step()

      # Standard elimination
      for i, swarm in enumerate(self.swarms):
        predposes = self.swarms[(i + 1) % n].positions
        if swarm.positions.size > 0 and predposes.size > 0:
          keys_swarm = swarm.positions[:, 1] * GRIDSIZE + swarm.positions[:, 0]
          keys_pred = predposes[:, 1] * GRIDSIZE + predposes[:, 0]
          mask = np.isin(keys_swarm, keys_pred)
          swarm.positions = swarm.positions[~mask]
          swarm.velocities = swarm.velocities[~mask]

      # Direct Pixel Rendering
      if self.gui:
        for swarm in self.swarms:
          if swarm.positions.size == 0:
            continue
          xs, ys = swarm.positions[:, 0], swarm.positions[:, 1]
          pixels[xs, ys] = swarm.colour
        del pixels
        self.screen.blit(self.pg.transform.scale(self.grid, WINDOWSIZE), (0, 0))
        self.pg.display.flip()
        self.clock.tick(150)

      # 4. End condition
      step += 1
      living = sum(1 for swarm in self.swarms if swarm.positions.size > 0)
      if step >= MAX_STEPS or living <= 2:
        running = False

    if self.gui:
      self.pg.quit()
    return self.metrics()

  def metrics(self):
    results = []
    for i, swarm in enumerate(self.swarms):
      living = 0 if swarm.positions.size == 0 else len(swarm.positions)
      prey = self.swarms[i - 1]
      prey_surviving = 0 if prey.positions.size == 0 else len(prey.positions)
      results.append({
        'swarm': i,
        'living': living,
        'prey_surviving': prey_surviving,
        'score': living - prey_surviving,
      })
    return results

  def print(self, results=None):
    print_match(
      results or self.metrics(),
      [swarm.client for swarm in self.swarms],
    )

class Swarm:
  def __init__(self, population, client, colour):
    flat = np.random.choice(GRIDSIZE * GRIDSIZE, size=population, replace=False)
    xs = flat % GRIDSIZE
    ys = flat // GRIDSIZE
    self.positions = np.column_stack((xs, ys))
    self.velocities = np.zeros((population, 2), dtype=int)
    self.client = client
    self.colour = np.asarray(colour, dtype=np.uint8)

  def getResponse(self, preyposes, predposes):
    if self.positions.size == 0:
      return
    self.velocities = self.client.getResponse(self.positions, preyposes, predposes)

  def step(self):
    if self.positions.size == 0:
      return

    self.positions += self.velocities
    
    while True:
      mask = (np.clip(self.positions, 0, GRIDSIZE - 1) != self.positions)
      self.positions -= self.velocities * mask
      self.velocities *= 1 - mask

      flat_positions = self.positions[:, 1] * GRIDSIZE + self.positions[:, 0]
      _, inverse, counts = np.unique(flat_positions, return_inverse=True, return_counts=True)
      
      if not np.any(counts > 1):
        break
      
      mask = (counts[inverse] > 1).astype(int).reshape(-1, 1)

      self.positions -= self.velocities * mask
      self.velocities *= 1 - mask

class Tournament:
  def __init__(self, population, workers=None):
    self.population = population
    self.workers = workers or os.cpu_count() or 1

  @staticmethod
  def _play(clients):
    return Game(clients, gui=False).run()

  def run(self, matches=None, sample=SAMPLE):
    if matches is None:
      matches = list(combinations(range(len(self.population)), 3))

    jobs = [tuple(self.population[i] for i in match) for match in matches for _ in range(sample)]
    if not jobs:
      return {'matches': [], 'scores': [0.0] * len(self.population)}

    with ProcessPoolExecutor(max_workers=self.workers) as pool:
      raw = list(pool.map(Tournament._play, jobs))

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

  def top(self, results, n=3):
    ids = nlargest(n, range(len(self.population)), key=results['scores'].__getitem__)
    return [self.population[i] for i in ids]

  def print(self, results):
    for i, rows in enumerate(results['matches']):
      print_match(rows, self.population, f'match {i}')
    print_scores(self.population, results['scores'])
