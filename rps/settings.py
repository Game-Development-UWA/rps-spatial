# Simulation Environment Configuration

# Spatial Dimensions
GRIDSIZE = (250, 250)              # Logical simulation grid (width, height)
WINDOWSIZE = (1600, 1200)   # Rendered Pygame window resolution (width, height)
MARGIN = 32

# Swarm Population & Setup
SPS = 0
SWARMS = 3                  # Swarms per match. Must be odd and >= 3
SWARMSIZE = 5000             # Initial number of units per swarm
MAX_STEPS = 400             # Simulation length before metrics are computed
SAMPLE = 2

# Display Styling
BACKGROUND = (30, 30, 30)   # Background clear color in RGB format

# Gaussian search box. Inclusive ranges. Sampling, clipping, mutation, and
# the config graph read these tuples as they are.
WEIGHT = (-0.5, 2.5)        # prey / pred / self / sep weights
SIGMA = (0.0, 48.0)         # blur radius in world pixels
CELL = (1, 16)              # occupancy bin size, whole pixels per cell

GENOMES_CSV = 'genomes.csv'   # catalog: the set is rows with visible=1
RESULTS_CSV = 'results.csv'   # append-only match log

# Evolutionary loop. True evaluates MU + LAMBDA; False evaluates LAMBDA.
# That count plus CHAMPION_SAMPLE must be divisible by SWARMS.
MU = 6
LAMBDA = 12
GENERATIONS = 10             # generations in one Optimizer.optimize run
REPLACEMENT = True           # True keeps the mu parents and the offspring; False keeps the offspring only
CROSSOVER = False             # True breeds by linear recombination; False mutates one parent
RECOMB_ALPHA = (-0.2, 1.2)    # per gene, uniform blend: 0 is parent A, 1 is parent B

# Swiss ladder. n is SWARMS. A match pays n-1 down to 0. The top rung is (n - 1) * TOURNAMENT_ROUNDS.
TOURNAMENT_ROUNDS = 4
CHAMPION_SAMPLE = 3          # champions drawn into each tournament; 0 until that many sit outside the live population.
ARCHIVE_TOP = 1              # new champions kept from the live population after a tournament

# Mutation. MUTATION_SIGMA is the standard deviation of a normal draw, as a fraction of each gene's range.
ADAPTIVE_MUTATION = True     # True applies the 1/5 rule to MUTATION_SIGMA each generation
MUTATION_SIGMA = 0.15
SIGMA_ADAPT = 1.2            # multiply the sigma when successes exceed 1/5; divide when they fall short
P_MUTATE = 0.2               # per gene, chance of adding a normal draw
P_PERTURB = 0.2              # per gene, chance of redrawing uniformly from that gene's range

_population = MU + LAMBDA if REPLACEMENT else LAMBDA
assert CHAMPION_SAMPLE % 3 == 0, 'CHAMPION_SAMPLE must be a multiple of 3, got ' + str(CHAMPION_SAMPLE)
assert _population % 3 == 0, 'population must be a multiple of 3, got ' + str(_population)
