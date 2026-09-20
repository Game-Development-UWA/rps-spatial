import time
import clients
from server import Game, Tournament


def winner_of(rows):
    return max(rows, key=lambda row: (row['score'], row['living'], row['kills']))


def main():
    population = [
        clients.Gaussian(),
        clients.Gaussian(prey_weight=3.0, pred_weight=1.0),
        clients.Gaussian(prey_weight=1.0, pred_weight=3.0),
        clients.Gaussian(prey_sigma=8.0, pred_sigma=24.0),
        clients.Gaussian(prey_sigma=24.0, pred_sigma=8.0),
        clients.Gaussian(cell=4),
        clients.Gaussian(cell=16),
        clients.Gaussian(swarm_near_weight=-0.5, swarm_far_weight=0.3),
        clients.Gaussian(prey_weight=4.0, pred_weight=2.0, prey_sigma=12.0),
    ]

    """
    TOURNAMENT STRUCTURE:
        finalists
        |   |   |   -> winners
    heat1 heat2 heat3
    """
    heats = [(0, 1, 2), (3, 4, 5), (6, 7, 8)]
    tournament = Tournament(population)

    started = time.perf_counter()
    heat_results = tournament.run(matches=heats, sample=1, swarms=3)
    finalists = [population[winner_of(rows)['id']] for rows in heat_results['matches']]
    final = Game(finalists)
    elapsed = time.perf_counter() - started

    final_results = final.run()
    print(f'ran 3 games in {elapsed:.3f}s')
    tournament.print(heat_results)
    print('finalists:', ', '.join(str(c) for c in finalists))
    print('final')
    final.print(final_results)


    # Client visualization
    new_clients = [clients.Gaussian(visualize=True), clients.Gaussian(pred_sigma=8.0, prey_sigma=24.0), clients.Gaussian(prey_weight=4.0, pred_weight=2.0, prey_sigma=12.0)]
    Game(new_clients).run()


if __name__ == "__main__":
    main()
