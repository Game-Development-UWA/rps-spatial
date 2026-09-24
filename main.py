import time
import clients
from server import Gui


def winner_of(rows):
    return max(rows, key=lambda row: (row['score'], row['living'], row['kills']))

def main():
    gui = Gui()
    gui.run()

if __name__ == "__main__":
    main()
