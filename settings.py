# Simulation Environment Configuration

# Spatial Dimensions
GRIDSIZE = (800, 800)              # Logical simulation grid dimension (1200x1200 cells)
WINDOWSIZE = (1600, 1200)   # Rendered Pygame window resolution (width, height)
MARGIN = 32

# Swarm Population & Setup
SPS = 0
SWARMS = 3                  # Swarms per tournament match. Must be odd and >= 3
SWARMSIZE = 50000             # Initial number of units per swarm
MAX_STEPS = 2000            # Simulation length before metrics are computed
SAMPLE = 5

# Display Styling
BACKGROUND = (30, 30, 30)   # Background clear color in RGB format
