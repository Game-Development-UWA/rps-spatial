# Simulation Environment Configuration

# Spatial Dimensions
GRIDSIZE = 400       # Logical simulation grid dimension (1200x1200 cells)
WINDOWSIZE = (1600, 1200) # Rendered Pygame window resolution (width, height)

# Clan Population & Setup
CLANS = 3             # Total number of competing clans in the Rock-Paper-Scissors cycle
CLANSIZE = 50     # Initial number of units per clan

# Simulation Rules
WRAP = False          # If True, units wrap around grid edges; if False, edges act as solid walls
TAG_MODE = True      # If True, caught prey units convert to predator clan; if False, caught prey are eliminated

# Display Styling
BACKGROUND = (30, 30, 30) # Background clear color in RGB format
