import time
import clients
from server import Game, Tournament

def main():
  population = [
    clients.Smple(0.3),
    clients.Smple(0.5),
    clients.Smple(0.7),
    clients.Simple(),
    clients.Client(),
    clients.Simple2(),
    clients.Smple(0.4),
  ]
  matches = [
    (0, 1, 2),
    (3, 1, 4),
    (5, 6, 3),
    (3, 1, 4),
    (5, 6, 3),
    (3, 1, 4),
    (5, 6, 3),
    (3, 1, 4),
    (5, 6, 3),
    (3, 1, 4),
  ]

  tournament = Tournament(population)
  started = time.perf_counter()
  results = tournament.run(matches)
  elapsed = time.perf_counter() - started

  tournament.print(results)
  print(f"elapsed={elapsed:.3f}s")

  finalists = tournament.top(results, 3)
  print('finalists:', ', '.join(str(c) for c in finalists))
  final = Game(finalists)
  final.print(final.run())

if __name__ == "__main__":
  main()
