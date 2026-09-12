import numpy as np
import sys
from server import Game, Swarm
import clients

from settings import *

def main():
  swarms = [
    Swarm(SWARMSIZE, clients.Smple(0.5), color=(220, 70, 70)),
    Swarm(SWARMSIZE, clients.Smple(0.5), color=(70, 200, 90)),
    Swarm(SWARMSIZE, clients.Smple(0.5), color=(70, 120, 230)),
  ]
  Game(swarms).run()

if __name__ == "__main__":
  main()
