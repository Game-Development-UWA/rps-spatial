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
  clans = []

  clans.append(server.Clan(CLANSIZE, clients.Smple(0.25)))
  clans.append(server.Clan(CLANSIZE, clients.Smple(0.5)))
  clans.append(server.Clan(CLANSIZE, clients.Smple(0.75)))

  running = True
  while running:
    for event in pg.event.get():
      if event.type == pg.QUIT:
        running = False

    screen.fill(BACKGROUND)
    grid.fill(BACKGROUND)
    pixels = pg.surfarray.pixels3d(grid)

    # 1. Update Clan Positions
    for i, clan in enumerate(clans):
      clan.step(clans[i - 1].positions, clans[(i + 1) % CLANS].positions)

    # Standard elimination
    for i, clan in enumerate(clans):
      predposes = clans[(i + 1) % CLANS].positions
      if clan.positions.size > 0 and predposes.size > 0:
        keys_clan = clan.positions[:, 1] * GRIDSIZE + clan.positions[:, 0]
        keys_pred = predposes[:, 1] * GRIDSIZE + predposes[:, 0]
        mask = np.isin(keys_clan, keys_pred)
        clan.positions = clan.positions[~mask]
        clan.velocities = clan.velocities[~mask]

    # 3. Direct Pixel Rendering
    for i, clan in enumerate(clans):
      if clan.positions.size == 0:
        continue
      color = (np.array(hsv_to_rgb(i / CLANS, 1, 1)) * 255).astype(np.uint8)
      xs, ys = clan.positions[:, 0], clan.positions[:, 1]
      pixels[xs, ys] = color

    del pixels

    screen.blit(pg.transform.scale(grid, WINDOWSIZE), (0, 0))
    pg.display.flip()

    clock.tick(20)

  pg.quit()
  sys.exit()

if __name__ == "__main__":
  main()
