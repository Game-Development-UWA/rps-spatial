import enum
import pygame as pg
import numpy as np
import sys
import server
import clients
from colorsys import hsv_to_rgb

from settings import *

def main():
  pg.init()
  screen = pg.display.set_mode(WINDOWSIZE)
  pg.display.set_caption("Rock Paper Scissors Simulation")

  clock = pg.time.Clock()
  grid = pg.Surface((GRIDSIZE, GRIDSIZE))
  swarms = []

  swarms.append(server.Swarm(SWARMSIZE, clients.Smple(0.25)))
  swarms.append(server.Swarm(SWARMSIZE, clients.Smple(0.5)))
  swarms.append(server.Swarm(SWARMSIZE, clients.Smple(0.75)))

  running = True
  while running:
    for event in pg.event.get():
      if event.type == pg.QUIT:
        running = False

    screen.fill(BACKGROUND)
    grid.fill(BACKGROUND)
    pixels = pg.surfarray.pixels3d(grid)

    # 1. Update Swarm Positions
    for i, swarm in enumerate(swarms):
      swarm.getResponse(swarms[i - 1].positions, swarms[(i + 1) % SWARMS].positions)
    
    for swarm in swarms:
      swarm.step()

    # Standard elimination
    for i, swarm in enumerate(swarms):
      predposes = swarms[(i + 1) % SWARMS].positions
      if swarm.positions.size > 0 and predposes.size > 0:
        keys_swarm = swarm.positions[:, 1] * GRIDSIZE + swarm.positions[:, 0]
        keys_pred = predposes[:, 1] * GRIDSIZE + predposes[:, 0]
        mask = np.isin(keys_swarm, keys_pred)
        swarm.positions = swarm.positions[~mask]
        swarm.velocities = swarm.velocities[~mask]

    # 3. Direct Pixel Rendering
    for i, swarm in enumerate(swarms):
      if swarm.positions.size == 0:
        continue
      color = (np.array(hsv_to_rgb(i / SWARMS, 1, 1)) * 255).astype(np.uint8)
      xs, ys = swarm.positions[:, 0], swarm.positions[:, 1]
      pixels[xs, ys] = color

    del pixels

    screen.blit(pg.transform.scale(grid, WINDOWSIZE), (0, 0))
    pg.display.flip()

    clock.tick(20)

  pg.quit()
  sys.exit()

if __name__ == "__main__":
  main()
