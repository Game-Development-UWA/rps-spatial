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

  clans.append(server.Clan(CLANSIZE, clients.Simple()))
  clans.append(server.Clan(CLANSIZE, clients.Simple()))
  clans.append(server.Clan(CLANSIZE, clients.Simple()))

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

    # 2. Tag / Elimination Phase
    if TAG_MODE:
      tagged_buffers = [np.empty((0, 2), dtype=int) for _ in range(CLANS)]

      # Pass 1: Identify tagged prey units
      for i in range(CLANS):
        clan = clans[i]
        pred_clan = clans[(i + 1) % CLANS]

        if clan.positions.size > 0 and pred_clan.positions.size > 0:
          keys_clan = clan.positions[:, 1] * GRIDSIZE + clan.positions[:, 0]
          keys_pred = pred_clan.positions[:, 1] * GRIDSIZE + pred_clan.positions[:, 0]

          mask = np.isin(keys_clan, keys_pred)

          if np.any(mask):
            tagged_buffers[i] = clan.positions[mask]
            clan.positions = clan.positions[~mask]
            clan.velocities = clan.velocities[~mask]

      # Pass 2: Transfer converted prey to predator clan in adjacent free spots
      for i in range(CLANS):
        converted_units = tagged_buffers[(i - 1) % CLANS]

        if converted_units.size > 0:
          # Track occupied cells in the receiving predator clan
          if clans[i].positions.size > 0:
            occupied_keys = set(clans[i].positions[:, 1] * GRIDSIZE + clans[i].positions[:, 0])
          else:
            occupied_keys = set()

          placed_positions = []
          neighbor_offsets = [
              (0, 1), (0, -1), (1, 0), (-1, 0),
              (1, 1), (1, -1), (-1, 1), (-1, -1),
              (0, 2), (0, -2), (2, 0), (-2, 0)
          ]

          for pos in converted_units:
            x, y = pos[0], pos[1]
            placed = False

            # Find the nearest unoccupied neighbor cell
            for dx, dy in neighbor_offsets:
              nx = (x + dx) % GRIDSIZE if WRAP else max(0, min(x + dx, GRIDSIZE - 1))
              ny = (y + dy) % GRIDSIZE if WRAP else max(0, min(y + dy, GRIDSIZE - 1))
              key = ny * GRIDSIZE + nx
              if key not in occupied_keys:
                occupied_keys.add(key)
                placed_positions.append([nx, ny])
                placed = True
                break

            # Fallback if immediate neighborhood is full
            if not placed:
              key = y * GRIDSIZE + x
              occupied_keys.add(key)
              placed_positions.append([x, y])

          if placed_positions:
            valid_arr = np.array(placed_positions, dtype=int)
            if clans[i].positions.size > 0:
              clans[i].positions = np.vstack((clans[i].positions, valid_arr))
              clans[i].velocities = np.vstack((clans[i].velocities, np.zeros_like(valid_arr)))
            else:
              clans[i].positions = valid_arr
              clans[i].velocities = np.zeros_like(valid_arr)

    else:
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
