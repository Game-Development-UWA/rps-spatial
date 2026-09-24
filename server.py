import colorsys
import multiprocessing as mp
import pygame as pg
import pygame_gui as pgui
import os
import sys
import clients
from concurrent.futures import ProcessPoolExecutor
from heapq import nlargest
from itertools import combinations

import numpy as np

from settings import *
from clients import *

def generate_colours(n, saturation=0.75, value=0.85):
    return [
        tuple(round(c * 255) for c in colorsys.hsv_to_rgb(i / n, saturation, value))
        for i in range(n)
    ]

def colour_text(text, rgb):
    r, g, b = (int(c) for c in rgb[:3])
    return f'\033[38;2;{r};{g};{b}m{text}\033[0m'

def gather(swarms, indices):
    """One (N, 2) array of every unit in `indices`. Clients take a single enemy
    array, so the k prey (or k predators) are concatenated into one."""
    parts = [swarms[i].positions for i in indices if swarms[i].positions.size]
    if not parts:
        return np.empty((0, 2), dtype=int)
    # the single-part fast path keeps k = 1 allocating exactly as it did before
    return parts[0] if len(parts) == 1 else np.concatenate(parts)

def print_match(rows, population, title=None, colours=None):
    if title:
        print(title)
    if colours is None:
        colours = generate_colours(len(rows))
    for i, row in enumerate(rows):
        client_id = row['id'] if 'id' in row else int(row['swarm'])
        line = (
            f"  id {client_id} {population[client_id]}: "
            f"living={row['living']:.2f} "
            f"prey_surviving={row['prey_surviving']:.2f} "
            f"kills={row['kills']:.1f} "
            f"score={row['score']:.2f}"
        )
        print(colour_text(line, colours[i]))

def print_scores(population, scores, title='final scores'):
    print(title)
    colours = generate_colours(len(population))
    for i, score in enumerate(scores):
        line = f'  id {i} {population[i]}: score={score:.2f}'
        print(colour_text(line, colours[i]))

class Swarm:
    def __init__(self, population, gridSize, client, colour):
        flat = np.random.choice(gridSize[0] * gridSize[1], size=population, replace=False)
        xs = flat % gridSize[0]
        ys = flat // gridSize[0]
        self.gridSize = np.array(gridSize)
        self.positions = np.column_stack((xs, ys))
        self.velocities = np.zeros((population, 2), dtype=int)
        self.client = client
        self.colour = np.asarray(colour, dtype=np.uint8)
        self.kills = 0
        # Pre-allocate state tracking buffer
        self._cell_to_agent = np.full(gridSize[0] * gridSize[1], -1, dtype=np.int32)

    def getResponse(self, preyposes, predposes):
        if self.positions.size == 0:
            return
        if preyposes.size == 0 and predposes.size == 0:
            # no prey and no predators left: nothing to chase or flee.
            # A single empty side is the client's business -- they contribute
            # only the term they have units for.
            self.velocities = np.zeros_like(self.velocities)
            return
        self.velocities = self.client.getResponse(self.positions, preyposes, predposes)

    def step(self):
        if self.positions.size == 0:
            return
    
        width, height = self.gridSize
        targets = self.positions + self.velocities
        total_cells = width * height
    
        # 1. OOB mask
        oob_mask = (
            (targets[:, 0] < 0) | (targets[:, 0] >= width) |
            (targets[:, 1] < 0) | (targets[:, 1] >= height)
        )
    
        flat_pos = self.positions[:, 1] * width + self.positions[:, 0]
        flat_targets = targets[:, 1] * width + targets[:, 0]
        valid_targets = np.where(oob_mask, -1, flat_targets)
        counts = np.bincount(valid_targets[valid_targets >= 0], minlength=total_cells)
        
        # 3. Initial blockers
        contention_mask = np.zeros(len(self.positions), dtype=bool)
        valid_indices = np.where(~oob_mask)[0]
        contention_mask[valid_indices] = counts[valid_targets[valid_indices]] > 1
        blocked_mask = oob_mask | contention_mask
    
        # 4. Map target cell -> agent ID using flat integer array instead of Python dict
        valid_agents = np.where(~blocked_mask)[0]
        valid_flat_targets = flat_targets[valid_agents]
        self._cell_to_agent[valid_flat_targets] = valid_agents
    
        # 5. Cascade blocks backward along collision chains
        queue = [flat_pos[i] for i in np.where(blocked_mask)[0]]
        while queue:
            blocked_cell = queue.pop()
            agent_id = self._cell_to_agent[blocked_cell]
            if agent_id != -1:
                self._cell_to_agent[blocked_cell] = -1  # Remove visited agent
                blocked_mask[agent_id] = True
                queue.append(flat_pos[agent_id])
    
        self._cell_to_agent[valid_flat_targets] = -1
        # 6. Apply updates
        self.positions = np.where(blocked_mask[:, None], self.positions, targets)
        self.velocities[blocked_mask] = 0

    def draw(self, grid):
        xs, ys = self.positions[:, 0], self.positions[:, 1]
        grid[xs, ys] = self.colour

class ClientSettingsWindow(pgui.elements.UIWindow):
    """Dynamically sized pop-up window with explicit parameter labels and inputs."""
    def __init__(self, manager, class_name, cls, callback, screen_size):
        self.callback = callback
        self.class_name, self.cls = class_name, cls
        self.entries = {}

        sig = inspect.signature(cls.__init__)
        valid_params = [
            (name, param) for name, param in sig.parameters.items()
            if name not in ('self', 'gridSize', 'grid_size', 'gridsize', 'args', 'kwargs')
        ]

        win_w = 340
        win_h = max(200, 60 + len(valid_params) * 42 + 55)
        center_pos = ((screen_size[0] - win_w) // 2, (screen_size[1] - win_h) // 2)

        super().__init__(
            pg.Rect(center_pos, (win_w, win_h)),
            manager, window_display_title=f"Configure: {class_name}"
        )

        y = 10
        if not valid_params:
            pgui.elements.UILabel(pg.Rect(15, y, 280, 30), "No customizable parameters.", manager, container=self)
            y += 40
        else:
            for name, param in valid_params:
                pgui.elements.UILabel(pg.Rect(15, y, 120, 30), f"{name}:", manager, container=self)
                entry = pgui.elements.UITextEntryLine(pg.Rect(140, y, 155, 30), manager, container=self)
                if param.default != inspect.Parameter.empty:
                    entry.set_text(str(param.default))

                self.entries[name] = entry
                y += 42

        self.btn_confirm = pgui.elements.UIButton(
            pg.Rect(15, y + 10, 280, 35), "Confirm & Add Client", manager, container=self
        )

    def process_event(self, event):
        handled = super().process_event(event)
        if event.type == pgui.UI_BUTTON_PRESSED and event.ui_element == self.btn_confirm:
            kwargs = {}
            for name, entry in self.entries.items():
                val = entry.get_text().strip()
                if val:
                    try:
                        kwargs[name] = float(val) if '.' in val else int(val)
                    except ValueError:
                        kwargs[name] = val in ("True", "true") if val.lower() in ("true", "false") else val
            
            self.callback(self.class_name, self.cls, kwargs)
            self.kill()
            return True
        return handled

class Gui:
    def __init__(self):
        pg.init()
        self.width, self.height = WINDOWSIZE
        self.screen = pg.display.set_mode(WINDOWSIZE, pg.RESIZABLE)
        pg.display.set_caption("Rock Paper Scissors Simulation")
        self.clock = pg.time.Clock()
        self.manager = pgui.UIManager(WINDOWSIZE)
        
        self.gridWidth, self.gridHeight = self.gridSize = GRIDSIZE
        self.content = pg.Surface(self.gridSize)
        self.margin = MARGIN * 2
        self.stepTime = (1 / SPS if SPS else 0)

        self.available_classes = {
            "Gaussian": clients.Gaussian,
            "Simple": clients.Simple,
            "Simple2": clients.Simple2,
            "Smple": clients.Smple,
            "Random": clients.Client,
        }
        self.selected_clients = []
        self.process = None
        self.colors = []
        
        # Graphing Variables
        self.graph_history = []
        self.max_history = 200

        self.setup_ui()
        self.resize()

    def setup_ui(self):
        """Sets up the left-hand dedicated Control Panel."""
        self.panel_width = 320
        self.panel = pgui.elements.UIPanel(
            pg.Rect(0, 0, self.panel_width, self.height), 
            manager=self.manager,
            anchors={'left': 'left', 'right': 'left', 'top': 'top', 'bottom': 'bottom'}
        )

        # --- Grid Settings ---
        pgui.elements.UILabel(pg.Rect(10, 10, 280, 20), "Grid Size (W x H):", self.manager, container=self.panel)
        self.entry_x = pgui.elements.UITextEntryLine(pg.Rect(10, 30, 135, 30), self.manager, container=self.panel)
        self.entry_y = pgui.elements.UITextEntryLine(pg.Rect(155, 30, 135, 30), self.manager, container=self.panel)
        self.entry_x.set_text(str(self.gridWidth)); self.entry_y.set_text(str(self.gridHeight))
        self.btn_apply = pgui.elements.UIButton(pg.Rect(10, 65, 280, 30), "Apply Grid Size", self.manager, container=self.panel)

        # --- Client Addition ---
        pgui.elements.UILabel(pg.Rect(10, 105, 280, 20), "Select Client Class:", self.manager, container=self.panel)
        self.dropdown = pgui.elements.UIDropDownMenu(
            list(self.available_classes.keys()), list(self.available_classes.keys())[0], 
            pg.Rect(10, 125, 280, 30), self.manager, container=self.panel
        )
        self.btn_add = pgui.elements.UIButton(pg.Rect(10, 160, 280, 32), "Configure & Add", self.manager, container=self.panel)

        # --- Queue Viewer (Dynamically sized in resize) ---
        self.txt_queue = pgui.elements.UITextBox(
            "", pg.Rect(10, 200, 280, 200), self.manager, container=self.panel
        )
        self.update_queue_display()

        # --- Controls anchored to the bottom of the panel ---
        bot_anchor = {'left': 'left', 'right': 'left', 'top': 'bottom', 'bottom': 'bottom'}
        
        pgui.elements.UILabel(pg.Rect(10, -185, 135, 25), "Graph Steps:", self.manager, container=self.panel, anchors=bot_anchor)
        self.entry_history = pgui.elements.UITextEntryLine(pg.Rect(155, -185, 135, 30), self.manager, container=self.panel, anchors=bot_anchor)
        self.entry_history.set_text(str(self.max_history))
        
        self.btn_clear = pgui.elements.UIButton(pg.Rect(10, -145, 280, 32), "Clear Entire Queue", self.manager, container=self.panel, anchors=bot_anchor)
        self.btn_game = pgui.elements.UIButton(pg.Rect(10, -105, 280, 32), "Start Game", self.manager, container=self.panel, anchors=bot_anchor)
        self.btn_tourn = pgui.elements.UIButton(pg.Rect(10, -70, 280, 32), "Start Tournament", self.manager, container=self.panel, anchors=bot_anchor)
        self.btn_train = pgui.elements.UIButton(pg.Rect(10, -35, 280, 32), "Start Train", self.manager, container=self.panel, anchors=bot_anchor)

    def instantiate_client(self, cls, grid_size, kwargs):
        sig = inspect.signature(cls.__init__)
        call_kwargs = dict(kwargs)
        grid_param = next((p for p in sig.parameters if p.lower() in ('gridsize', 'grid_size', 'size')), None)
        if grid_param:
            call_kwargs[grid_param] = grid_size
            return cls(**call_kwargs)
        try:
            return cls(grid_size, **call_kwargs)
        except TypeError:
            return cls(**call_kwargs)

    def add_client_callback(self, name, cls, kwargs):
        self.selected_clients.append({"name": name, "cls": cls, "kwargs": kwargs})
        self.update_queue_display()

    def update_queue_display(self):
        if not self.selected_clients:
            self.txt_queue.set_text("<b>Queued Clients:</b><br><i>None</i>")
            return
            
        lines = ["<b>Queued Clients:</b>"]
        for idx, c in enumerate(self.selected_clients):
            params = ", ".join(f"{k}={v}" for k, v in c['kwargs'].items())
            # Hyperlink used to trigger removal on click
            link = f'<a href="rm_{idx}">[X]</a>'
            lines.append(f"{link} {idx+1}. <b>{c['name']}</b>({params})")
        self.txt_queue.set_text("<br>".join(lines))

    def resize(self):
        self.manager.set_window_resolution((self.width, self.height))
        self.panel.set_dimensions((self.panel_width, self.height))
        self.txt_queue.set_dimensions((280, max(100, self.height - 400))) # Stretch queue box to fit available vertical space

        # Right side split: Top 65% Simulation, Bottom 35% Graph
        visual_w = self.width - self.panel_width
        sim_h = int(self.height * 0.65)
        
        self.sim_rect = pg.Rect(self.panel_width, 0, visual_w, sim_h)
        self.graph_rect = pg.Rect(self.panel_width, sim_h, visual_w, self.height - sim_h)

        # Calculate Simulation Surface Scaling/Centering
        scale = min((self.sim_rect.width - self.margin) / self.gridWidth, (self.sim_rect.height - self.margin) / self.gridHeight)
        self.contentSize = (int(self.gridWidth * scale), int(self.gridHeight * scale))
        self.contentPos = (
            self.sim_rect.left + (self.sim_rect.width - self.contentSize[0]) // 2,
            self.sim_rect.top + (self.sim_rect.height - self.contentSize[1]) // 2
        )

    def draw_graph(self):
        # Draw Background and Border
        pg.draw.rect(self.screen, (30, 30, 30), self.graph_rect)
        pg.draw.rect(self.screen, (100, 100, 100), self.graph_rect, 2)

        if not self.graph_history: return

        # Stack into numpy array of shape (steps, num_graphs)
        history = np.array(self.graph_history)
        num_graphs = history.shape[1] if len(history.shape) > 1 else 1

        min_y, max_y = np.min(history), np.max(history)
        range_y = (max_y - min_y) if max_y != min_y else 1

        pad = 10
        draw_w = self.graph_rect.width - (pad * 2)
        draw_h = self.graph_rect.height - (pad * 2)

        for i in range(num_graphs):
            color = self.colors[i % len(self.colors)] if self.colors else (255, 255, 255)
            y_data = history[:, i] if len(history.shape) > 1 else history

            points = []
            for x_idx, y_val in enumerate(y_data):
                px = self.graph_rect.left + pad + (x_idx / max(1, self.max_history - 1)) * draw_w
                py = self.graph_rect.bottom - pad - ((y_val - min_y) / range_y) * draw_h
                points.append((px, py))
            
            if len(points) > 1:
                pg.draw.lines(self.screen, color, False, points, 2)

    def run(self):
        accumulator = 0.0
        running = True
        while running:
            dt = self.clock.tick(60) / 1000
            
            for event in pg.event.get():
                if event.type == pg.QUIT: 
                    running = False
                elif event.type == pg.VIDEORESIZE:
                    self.width, self.height = event.w, event.h
                    self.resize()

                # Handle Link Clicks (Remove Client)
                elif event.type == pgui.UI_TEXT_BOX_LINK_CLICKED:
                    if event.ui_element == self.txt_queue and event.link_target.startswith("rm_"):
                        idx = int(event.link_target.split("_")[1])
                        if 0 <= idx < len(self.selected_clients):
                            self.selected_clients.pop(idx)
                            self.update_queue_display()

                # Handle Text Input (Graph Length)
                elif event.type == pgui.UI_TEXT_ENTRY_FINISHED and event.ui_element == self.entry_history:
                    try:
                        self.max_history = max(10, int(self.entry_history.get_text()))
                    except ValueError: pass

                elif event.type == pgui.UI_BUTTON_PRESSED:
                    if event.ui_element == self.btn_add:
                        name = self.dropdown.selected_option
                        name = name[0] if isinstance(name, tuple) else name
                        ClientSettingsWindow(
                            self.manager, name, self.available_classes[name], 
                            self.add_client_callback, (self.width, self.height)
                        )

                    elif event.ui_element == self.btn_clear:
                        self.selected_clients.clear()
                        self.update_queue_display()

                    elif event.ui_element == self.btn_apply:
                        try:
                            self.gridWidth, self.gridHeight = self.gridSize = (int(self.entry_x.get_text()), int(self.entry_y.get_text()))
                            self.content = pg.Surface(self.gridSize)
                            self.resize()
                        except ValueError: pass

                    elif event.ui_element == self.btn_game and self.selected_clients:
                        instances = [self.instantiate_client(c['cls'], self.gridSize, c['kwargs']) for c in self.selected_clients]
                        self.colors = generate_colours(len(instances))
                        self.process = Game(instances, [5000] * len(instances), self.colors, self.gridSize)
                        self.graph_history.clear()

                self.manager.process_events(event)

            self.manager.update(dt)
            accumulator += dt
            self.screen.fill((50, 50, 50))

            if accumulator >= self.stepTime:
                if self.process:
                    try:
                        out = self.process.step()
                        self.content.fill("Black")
                        self.process.draw(self.content)
                        
                        # Graph data ingestion
                        if out is not None and hasattr(out, 'flatten'):
                            self.graph_history.append(out.flatten())
                            if len(self.graph_history) > self.max_history:
                                self.graph_history = self.graph_history[-self.max_history:]

                    except AttributeError: pass
                accumulator -= self.stepTime

            # Draw Simulation Layer
            self.screen.blit(pg.transform.scale(self.content, self.contentSize), self.contentPos)
            
            # Draw Graph Layer
            self.draw_graph()

            # Draw UI Layer (Over everything)
            self.manager.draw_ui(self.screen)
            pg.display.flip()

class Game:
    def __init__(self, clients, sizes, colours, gridSize):
        n = len(clients)
        if n < 3 or n % 2 == 0:
            raise ValueError(
                f'generalised RPS needs an odd number of swarms >= 3, got {n}. '
                'An even count makes i and i + n/2 beat each other, so the '
                'relation stops being a tournament.'
            )
        # each swarm eats the k below it on the cycle and is eaten by the k above
        self.gridSize = gridSize
        self.k = (n - 1) // 2
        self.swarms = [Swarm(size, gridSize, client, colour) for client, size, colour in zip(clients, sizes, colours)]
        self.n = len(self.swarms)
        self.prey_of = [[(i - d) % n for d in range(1, self.k + 1)] for i in range(n)]
        self.pred_of = [[(i + d) % n for d in range(1, self.k + 1)] for i in range(n)]
        # Pre-allocate flat grid for O(1) collision lookups
        self._grid_occupied = np.zeros(gridSize[0] * gridSize[1], dtype=bool)

    def step(self):
        # Update Swarm Positions
        for i, swarm in enumerate(self.swarms):
            swarm.getResponse(
                gather(self.swarms, self.prey_of[i]),
                gather(self.swarms, self.pred_of[i]),
            )
        for swarm in self.swarms:
            swarm.step()
    
        # Standard elimination
        # 1. Snapshot the board
        total_cells = self.gridSize[0] * self.gridSize[1]
        keys = [
            swarm.positions[:, 1] * self.gridSize[0] + swarm.positions[:, 0]
            if swarm.positions.size else np.empty(0, dtype=int)
            for swarm in self.swarms
        ]
    
        dead = [np.zeros(len(key), dtype=bool) for key in keys]
    
        # 2. Resolve every pairing against the snapshot
        for d in range(1, self.k + 1):
            for i in range(self.n):
                j = (i - d) % self.n
                if keys[i].size == 0 or keys[j].size == 0:
                    continue
                
                # Mark predator cell positions in boolean array
                self._grid_occupied[keys[i]] = True
    
                # Fast boolean lookup instead of np.isin
                eats = self._grid_occupied[keys[j]] & ~dead[j]
                self.swarms[i].kills += int(eats.sum())
                dead[j] |= eats

                self._grid_occupied[keys[i]] = False
    
        # 3. Apply deletions
        for swarm, mask in zip(self.swarms, dead):
            if mask.any():
                swarm.positions = swarm.positions[~mask]
                swarm.velocities = swarm.velocities[~mask]
    
        living = sum(1 for swarm in self.swarms if swarm.positions.size > 0)
        if living <= 2:
            return self.metrics()

    def draw(self, content):
        arr = pg.surfarray.pixels3d(content)
        for swarm in self.swarms:
            swarm.draw(arr)

    def metrics(self):
        n = len(self.swarms)
        results = []
        for i, swarm in enumerate(self.swarms):
            living = 0 if swarm.positions.size == 0 else len(swarm.positions)
            prey_surviving = sum(
                len(self.swarms[(i - d) % n].positions) for d in range(1, self.k + 1)
            )
            results.append({
                'swarm': i,
                'living': living,
                'prey_surviving': prey_surviving,
                'kills': swarm.kills,
                'score': living - prey_surviving,
            })
        return results

    def print(self, results=None):
        print_match(
            results or self.metrics(),
            [swarm.client for swarm in self.swarms],
            colours=[swarm.colour for swarm in self.swarms],
        )

class Tournament:
    def __init__(self, population, workers=None):
        self.population = population
        self.workers = workers or os.cpu_count() or 1

    @staticmethod
    def _play(clients):
        return Game(clients).step()

    def run(self, matches=None, sample=SAMPLE, swarms=SWARMS):
        if matches is None:
            if len(self.population) < swarms:
                raise ValueError(
                    f'need at least {swarms} clients to fill a match, '
                    f'population has {len(self.population)}'
                )
            matches = list(combinations(range(len(self.population)), swarms))

        jobs = [tuple(self.population[i] for i in match) for match in matches for _ in range(sample)]
        if not jobs:
            return {'matches': [], 'scores': [0.0] * len(self.population)}

        workers = max(1, min(self.workers, len(jobs)))
        if workers == 1 or len(jobs) == 1:
            raw = [Tournament._play(job) for job in jobs]
        else:
            # fork copies the already-imported numpy/scipy runtime; spawn
            # would re-import in every worker and dominate small tournaments.
            ctx = None if sys.platform == 'win32' else mp.get_context('fork')
            with ProcessPoolExecutor(max_workers=workers, mp_context=ctx) as pool:
                raw = list(pool.map(Tournament._play, jobs, chunksize=1))


        report, bags = [], [[] for _ in self.population]
        for i, match in enumerate(matches):
            chunk = raw[i * sample:(i + 1) * sample]
            rows = []
            for slot, cid in enumerate(match):
                samples = [trial[slot] for trial in chunk]
                avg = {
                    key: sum(row[key] for row in samples) / len(samples)
                    for key in samples[0]
                }
                bags[cid].append(avg['score'])
                rows.append({'id': cid, **avg})
            report.append(rows)

        scores = [sum(bag) / len(bag) if bag else 0.0 for bag in bags]
        return {'matches': report, 'scores': scores}

    def fitness(self, results):
        return results['scores']

    def top(self, results, n=SWARMS):
        ids = nlargest(n, range(len(self.population)), key=results['scores'].__getitem__)
        return [self.population[i] for i in ids]

    def print(self, results):
        for i, rows in enumerate(results['matches']):
            print_match(rows, self.population, f'match {i}')
        print_scores(self.population, results['scores'])
