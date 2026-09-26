# Simulation Environment Configuration

# Spatial Dimensions
GRIDSIZE = (250, 250)              # Logical simulation grid (width, height)
WINDOWSIZE = (1600, 1200)   # Rendered Pygame window resolution (width, height)
MARGIN = 32

# Swarm Population & Setup
SPS = 0
SWARMS = 3                  # Swarms per tournament match. Must be odd and >= 3
SWARMSIZE = 50000             # Initial number of units per swarm
MAX_STEPS = 400             # Simulation length before metrics are computed
SAMPLE = 5

# Display Styling
BACKGROUND = (30, 30, 30)   # Background clear color in RGB format

# Gaussian parameter box — Train samples and clips inside this, and the
# config graph uses the same extents so dots stay on-axis.
MAX_WEIGHT = 2.0            # |prey/pred/self/sep weights|
MAX_SIGMA = 48.0            # blur radius in world pixels
MAX_CELLS = 16              # occupancy bin size (pixels per cell)

GENOMES_CSV = 'genomes.csv'   # catalog: the set is rows with visible=1
RESULTS_CSV = 'results.csv'   # append-only match log
