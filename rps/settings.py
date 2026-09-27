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
SAMPLE = 5

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
CROSSOVER = True             # True breeds from the mean of two parents; False mutates one parent

# Swiss tournament. n is SWARMS.
TOURNAMENT_ROUNDS = 4
CHAMPION_SAMPLE = 3          # champions drawn into each tournament; 0 until the archive has any
NORMALIZATION = 'min-max'    # 'min-max' or 'z-score', applied inside one match
AGGREGATION = 'average'      # 'sum' or 'average' of an individual's round scores
ARCHIVE_TOP = 1              # new champions kept from the live population after a tournament

# Mutation. MUTATION_SIGMA is the 1/5-rule deviation, as a fraction of each gene's range.
MUTATION_SIGMA = 0.15
SIGMA_ADAPT = 1.2            # multiply the sigma when successes exceed 1/5; divide when they fall short
P_MUTATE = 0.2               # per gene, chance of a small normal step
P_PERTURB = 0.2              # per gene, chance of redrawing uniformly from that gene's range
