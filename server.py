import numpy as np
from settings import *

class Game:
  def __init__(self, swarms, gui=True):
    self.swarms = swarms
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
          pixels[xs, ys] = swarm.color
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
      score = living - prey_surviving
      results.append((i, living, prey_surviving, score, swarm.color))
    return results

class Swarm:
  def __init__(self, population, client, color):
    flat = np.random.choice(GRIDSIZE * GRIDSIZE, size=population, replace=False)
    xs = flat % GRIDSIZE
    ys = flat // GRIDSIZE
    self.positions = np.column_stack((xs, ys))
    self.velocities = np.zeros((population, 2), dtype=int)
    self.client = client
    self.color = np.asarray(color, dtype=np.uint8)

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

  def getpixarr(self, color):
    pixels = np.zeros((GRIDSIZE, GRIDSIZE, 3), dtype=np.uint8)

    if self.positions.size > 0:
      xs = self.positions[:, 0]
      ys = self.positions[:, 1]
      pixels[xs, ys] = np.array(color) * 255

    return pixels
