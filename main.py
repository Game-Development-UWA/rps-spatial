# Stop pygame from printing support prompt in child processes etc.
# ------------------------------------------------------------
import multiprocessing as mp
import os
if mp.current_process().name != 'MainProcess':
    os.environ['PYGAME_HIDE_SUPPORT_PROMPT'] = '1'
    os.environ['SDL_VIDEODRIVER'] = 'dummy'
    os.environ['SDL_AUDIODRIVER'] = 'dummy'
# ------------------------------------------------------------
from rps.gui import Gui


def main():
    Gui().run()


if __name__ == "__main__":
    main()
