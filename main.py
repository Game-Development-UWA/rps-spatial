from server import Game, Swarm
import clients

from settings import *

def main():
  swarms = [
    Swarm(SWARMSIZE, clients.Smple(0.5), color=(220, 70, 70)),
    Swarm(SWARMSIZE, clients.Smple(0.5), color=(70, 200, 90)),
    Swarm(SWARMSIZE, clients.Smple(0.5), color=(70, 120, 230)),
  ]
  results = Game(swarms).run()

  for i, living, prey_surviving, score, color in results:
    r, g, b = (int(c) for c in color)
    print(f"\033[38;2;{r};{g};{b}mswarm {i}: living={living} prey_surviving={prey_surviving} score={score}\033[0m")

if __name__ == "__main__":
  main()
