import numpy as np
from settings import *

class Swarm:
  def __init__(self, population, client):
    flat = np.random.choice(GRIDSIZE * GRIDSIZE, size=population, replace=False)
    xs = flat % GRIDSIZE
    ys = flat // GRIDSIZE
    self.positions = np.column_stack((xs, ys))
    self.velocities = np.zeros((population, 2), dtype=int)
    self.client = client

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
