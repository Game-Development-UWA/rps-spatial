import html
import inspect
import math
import os
import traceback

import numpy as np
import pygame as pg
import pygame_gui as pgui
from pygame_gui.windows import UIMessageWindow

from . import clients
from .catalog import PARAM_KEYS, Catalog
from .game import Game, generate_colours, legal_match_count
from .optimize import Optimizer, TrainingStopped, clip_params, default_params, sample_params
from .settings import *

DOT_COLOUR = {
    'prey': (70, 200, 90),
    'pred': (220, 60, 70),
    'self': (70, 140, 230),
    'sep': (20, 50, 140),
}


def gaussian_pairs():
    """Weight/sigma keys from the catalog, in catalog order, with a plot colour."""
    pairs = []
    for key in PARAM_KEYS:
        if not key.endswith('_weight'):
            continue
        name = key[:-len('_weight')]
        pairs.append((name, key, name + '_sigma', DOT_COLOUR.get(name, (220, 220, 220))))
    return pairs


def gaussian_dots(params):
    return [
        (name, params.get(weight_key, 0.0), params.get(sigma_key, 0.0), colour)
        for name, weight_key, sigma_key, colour in gaussian_pairs()
    ]


def _unit(value, bounds):
    lo, hi = bounds
    span = hi - lo or 1.0
    return min(1.0, max(0.0, (float(value) - lo) / span))


def _rgb(red, green, blue):
    """Lift a 0–1 channel so a quiet strategy stays visible on the dark panels."""
    return tuple(int(round(32 + 208 * min(1.0, max(0.0, channel)))) for channel in (red, green, blue))


def strategy_gradient(params):
    """Two colours for one genome: how it acts, then how widely it acts.

    Red is fleeing predators, green is chasing prey. Blue is the local force:
    deep blue when separation wins, pale blue when cohesion wins. The first
    colour is those three weights. The second is the matching sigmas.
    """
    prey_w = _unit(params.get('prey_weight', WEIGHT[0]), WEIGHT)
    pred_w = _unit(params.get('pred_weight', WEIGHT[0]), WEIGHT)
    self_w = _unit(params.get('self_weight', WEIGHT[0]), WEIGHT)
    sep_w = _unit(params.get('sep_weight', WEIGHT[0]), WEIGHT)
    prey_s = _unit(params.get('prey_sigma', SIGMA[0]), SIGMA)
    pred_s = _unit(params.get('pred_sigma', SIGMA[0]), SIGMA)
    self_s = _unit(params.get('self_sigma', SIGMA[0]), SIGMA)
    sep_s = _unit(params.get('sep_sigma', SIGMA[0]), SIGMA)
    spread = sep_w >= self_w

    def pack(flee, chase, local, spreading):
        if spreading:
            return _rgb(flee, chase, local)
        return _rgb(max(flee, local), max(chase, local), local)

    return (
        pack(pred_w, prey_w, sep_w if spread else self_w, spread),
        pack(pred_s, prey_s, sep_s if spread else self_s, spread),
    )


def plot_candidate(params):
    return {'gradient': strategy_gradient(params), 'dots': gaussian_dots(params)}


def _lerp_rgb(start, end, t):
    return tuple(int(start[i] + (end[i] - start[i]) * t) for i in range(3))


def _fill_h_gradient(surf, rect, start, end):
    if rect.width <= 0 or rect.height <= 0:
        return
    span = max(1, rect.width - 1)
    for x in range(rect.width):
        colour = _lerp_rgb(start, end, x / span)
        pg.draw.line(surf, colour, (rect.left + x, rect.top), (rect.left + x, rect.bottom - 1))


def _draw_gradient_lines(surf, start, end, pts, width):
    if len(pts) < 2:
        return
    lengths = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:])]
    total = sum(lengths)
    if total <= 0:
        pg.draw.lines(surf, start, False, pts, width)
        return
    walked = 0.0
    for (a, b), dist in zip(zip(pts, pts[1:]), lengths):
        t0 = walked / total
        walked += dist
        t1 = walked / total
        steps = max(1, int(dist / 4))
        for step in range(steps):
            u0 = step / steps
            u1 = (step + 1) / steps
            p0 = (int(a[0] + (b[0] - a[0]) * u0), int(a[1] + (b[1] - a[1]) * u0))
            p1 = (int(a[0] + (b[0] - a[0]) * u1), int(a[1] + (b[1] - a[1]) * u1))
            colour = _lerp_rgb(start, end, t0 + (t1 - t0) * (u0 + u1) / 2)
            if p0 != p1:
                pg.draw.line(surf, colour, p0, p1, width)


def _graph_font(size):
    if not pg.font.get_init():
        pg.font.init()
    return pg.font.Font(None, size)


def _opaque_text(font, text, color=(255, 255, 255), bg=(18, 18, 22)):
    img = font.render(str(text), True, color, bg)
    if img.get_flags() & pg.SRCALPHA:
        opaque = pg.Surface(img.get_size())
        opaque.fill(bg)
        opaque.blit(img, (0, 0))
        return opaque
    return img


def _blit_label(surf, text, pos, font, color=(255, 255, 255), anchor='topleft', bg=(18, 18, 22)):
    img = _opaque_text(font, text, color, bg)
    rect = img.get_rect(**{anchor: pos})
    surf.blit(img, rect)
    return rect


def _scroll(rect, manager, container):
    try:
        return pgui.elements.UIScrollingContainer(rect, manager, container=container, allow_scroll_x=False)
    except TypeError:
        return pgui.elements.UIScrollingContainer(rect, manager, container=container)


def _set_scroll_h(scroll, height, width=270):
    if hasattr(scroll, 'set_scrollable_area_dimensions'):
        scroll.set_scrollable_area_dimensions((width, max(height, 80)))


def _confirmed(event, button):
    if event.type == pgui.UI_BUTTON_PRESSED and event.ui_element == button:
        return True
    if event.type == pgui.UI_TEXT_ENTRY_FINISHED:
        return True
    return event.type == pg.KEYDOWN and event.key in (pg.K_RETURN, pg.K_KP_ENTER)


def draw_weight_sigma_graph(surf, candidates, highlight=None, labels=True):
    """One WEIGHT×SIGMA plot. Each candidate contributes prey / pred / self / sep dots."""
    surf.fill((18, 18, 22))
    w, h = surf.get_size()
    if labels:
        pad_l, pad_b, pad_r, pad_t = 72, 64, 16, 14
    else:
        pad_l, pad_b, pad_r, pad_t = 4, 4, 4, 4
    plot = pg.Rect(pad_l, pad_t, max(8, w - pad_l - pad_r), max(8, h - pad_t - pad_b))
    pg.draw.rect(surf, (32, 32, 38), plot)
    pg.draw.rect(surf, (140, 140, 150), plot, 1)

    (lo_w, hi_w), (lo_s, hi_s) = WEIGHT, SIGMA
    span_w = hi_w - lo_w or 1.0
    span_s = hi_s - lo_s or 1.0

    font = _graph_font(26) if labels else None
    small = _graph_font(22) if labels else None

    def to_px(weight, sigma):
        x = plot.left + (weight - lo_w) / span_w * plot.width
        y = plot.bottom - (sigma - lo_s) / span_s * plot.height
        return int(x), int(y)

    if lo_w < 0 < hi_w:
        zx, _ = to_px(0.0, lo_s)
        pg.draw.line(surf, (90, 90, 100), (zx, plot.top), (zx, plot.bottom), 1)

    for i, cand in enumerate(candidates):
        pts = [to_px(weight, sigma) for _, weight, sigma, _ in cand['dots']]
        gradient = cand.get('gradient')
        if gradient and len(pts) >= 2:
            _draw_gradient_lines(surf, gradient[0], gradient[1], pts, 2)
        elif len(pts) >= 2:
            ring = cand.get('colour', (230, 230, 230))
            pg.draw.lines(surf, (*ring[:3],), False, pts, 2)
        for (_, _w, _s, colour), pos in zip(cand['dots'], pts):
            r = 8 if labels and i == highlight else (6 if labels else 3)
            pg.draw.circle(surf, colour, pos, r)
            pg.draw.circle(surf, (0, 0, 0), pos, r, 1)

    if not labels:
        return plot

    for frac, val in ((0.0, lo_w), (0.5, 0.5 * (lo_w + hi_w)), (1.0, hi_w)):
        x = plot.left + frac * plot.width
        pg.draw.line(surf, (180, 180, 188), (x, plot.bottom), (x, plot.bottom + 5), 2)
        _blit_label(surf, f'{val:g}', (x, plot.bottom + 8), small, anchor='midtop')
    for frac, val in ((0.0, lo_s), (0.5, 0.5 * (lo_s + hi_s)), (1.0, hi_s)):
        y = plot.bottom - frac * plot.height
        pg.draw.line(surf, (180, 180, 188), (plot.left - 5, y), (plot.left, y), 2)
        _blit_label(surf, f'{val:g}', (plot.left - 8, y), small, anchor='midright')

    _blit_label(surf, 'WEIGHT', (plot.centerx, h - 6), font, anchor='midbottom')
    ylab = pg.transform.rotate(_opaque_text(font, 'SIGMA'), 90)
    surf.blit(ylab, (6, plot.centery - ylab.get_height() // 2))

    lx = plot.left
    ly = 4
    for label, _, _, colour in gaussian_pairs():
        pg.draw.circle(surf, colour, (lx + 6, ly + 8), 5)
        rect = _blit_label(surf, label, (lx + 16, ly + 8), small, anchor='midleft')
        lx = rect.right + 14

    return plot


def draw_bracket(surf, seating, rounds, colours=None):
    """Columns are rounds. Each card is one match: the genomes that fight each other."""
    surf.fill((30, 30, 30))
    width, height = surf.get_size()
    if width < 8 or height < 8:
        return
    font = _graph_font(18)
    header_font = _graph_font(22)
    colours = colours or {}
    pad = 8
    header_h = 28
    col_w = (width - pad * 2) / max(1, rounds)
    n_matches = max((len(column) for column in seating), default=1)
    body_top = header_h + 2
    match_h = (height - body_top - pad) / n_matches
    for r in range(rounds):
        x = pad + r * col_w
        playing = (
            r < len(seating)
            and any(pts is None for match in seating[r] for _gid, pts in match)
        )
        title_colour = (240, 240, 240) if r < len(seating) else (110, 110, 110)
        _blit_label(
            surf, f'Round {r + 1}', (x + col_w / 2, 4), header_font,
            color=title_colour, anchor='midtop', bg=(30, 30, 30),
        )
        if r >= len(seating):
            continue
        for m, match in enumerate(seating[r]):
            card = pg.Rect(
                int(x + 4), int(body_top + m * match_h + 2),
                max(1, int(col_w - 8)), max(1, int(match_h - 4)),
            )
            pg.draw.rect(surf, (36, 36, 42), card)
            pg.draw.rect(surf, (190, 190, 198) if playing else (80, 80, 88), card, 1)
            if not match:
                continue
            chip_w = card.width / len(match)
            clip = surf.get_clip()
            for s, (gid, pts) in enumerate(match):
                cx = card.left + s * chip_w
                seat = pg.Rect(int(cx), card.top, max(1, int(chip_w)), card.height)
                surf.set_clip(seat)
                if s > 0:
                    pg.draw.line(surf, (70, 70, 78), (seat.left, card.top + 4), (seat.left, card.bottom - 4), 1)
                ends = colours.get(gid, ((200, 200, 200), (200, 200, 200)))
                if not (isinstance(ends, tuple) and len(ends) == 2 and isinstance(ends[0], tuple)):
                    ends = (ends, ends)
                bar = pg.Rect(seat.left + 4, seat.top + 3, max(1, seat.width - 8), 5)
                _fill_h_gradient(surf, bar, ends[0], ends[1])
                label_y = card.centery if pts is None or card.height < 36 else card.top + 16
                _blit_label(
                    surf, str(gid), (seat.left + 8, label_y), font,
                    anchor='midleft', bg=(36, 36, 42),
                )
                if pts is not None and card.height >= 36:
                    _blit_label(
                        surf, f'{pts:g}', (seat.centerx, card.bottom - 4), font,
                        anchor='midbottom', bg=(36, 36, 42),
                    )
                elif pts is not None:
                    _blit_label(
                        surf, f'{pts:g}', (seat.right - 4, card.centery), font,
                        anchor='midright', bg=(36, 36, 42),
                    )
            surf.set_clip(clip)
    pg.draw.rect(surf, (100, 100, 100), surf.get_rect(), 2)


class ClientSettingsWindow(pgui.elements.UIWindow):
    """Dynamically sized pop-up window with explicit parameter labels and inputs."""
    def __init__(self, manager, class_name, cls, callback, screen_size, values=None, confirm_label=None):
        self.callback = callback
        self.class_name, self.cls = class_name, cls
        self.entries = {}
        values = values or {}

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
                if name in values:
                    entry.set_text(str(values[name]))
                elif param.default != inspect.Parameter.empty:
                    entry.set_text(str(param.default))

                self.entries[name] = entry
                y += 42

        self.btn_confirm = pgui.elements.UIButton(
            pg.Rect(15, y + 10, 280, 35),
            confirm_label or "Confirm & Add Client",
            manager, container=self
        )

    def _confirm(self):
        if not self.alive():
            return
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

    def process_event(self, event):
        handled = super().process_event(event)
        if _confirmed(event, self.btn_confirm):
            self._confirm()
            return True
        return handled


class GaussianConfigWindow(pgui.elements.UIWindow):
    """Single WEIGHT×SIGMA graph: prey / pred / self / sep."""

    def __init__(self, manager, callback, screen_size, params=None, confirm_label=None):
        self.callback = callback
        self.params = clip_params(params or default_params())
        self.drag = None
        win_w, win_h = 560, 520
        center = ((screen_size[0] - win_w) // 2, (screen_size[1] - win_h) // 2)
        super().__init__(
            pg.Rect(center, (win_w, win_h)),
            manager, window_display_title='Configure: Gaussian',
        )
        self.plot_size = (532, 390)
        self.plot_surf = pg.Surface(self.plot_size)
        self.plot_image = pgui.elements.UIImage(
            pg.Rect(8, 8, *self.plot_size), self.plot_surf, manager, container=self,
        )
        cell_cap = pg.Surface((56, 32))
        cell_cap.fill((28, 28, 32))
        _blit_label(cell_cap, 'cell', (28, 16), _graph_font(24), anchor='center', bg=(28, 28, 32))
        pgui.elements.UIImage(pg.Rect(8, 406, 56, 32), cell_cap, manager, container=self)
        self.cell_entry = pgui.elements.UITextEntryLine(pg.Rect(68, 406, 72, 32), manager, container=self)
        self.cell_entry.set_text(str(self.params.get('cell', 2)))
        self.btn_random = pgui.elements.UIButton(
            pg.Rect(148, 406, 196, 32), 'initialise random', manager, container=self,
        )
        self.btn_confirm = pgui.elements.UIButton(
            pg.Rect(352, 406, 188, 32), confirm_label or 'Add', manager, container=self,
        )
        self.redraw()

    def _randomise(self):
        self.params = sample_params()
        self.cell_entry.set_text(str(self.params.get('cell', 2)))
        self.redraw()

    def _confirm(self):
        if not self.alive():
            return
        try:
            self.params['cell'] = int(self.cell_entry.get_text())
        except ValueError:
            pass
        self.callback('Gaussian', clients.Gaussian, clip_params(self.params))
        self.kill()

    def redraw(self):
        self.plot_rect = draw_weight_sigma_graph(self.plot_surf, [plot_candidate(self.params)])
        self.plot_image.set_image(self.plot_surf.convert())

    def _from_px(self, pos):
        (lo_w, hi_w), (lo_s, hi_s) = WEIGHT, SIGMA
        rel = (pos[0] - self.plot_rect.left, pos[1] - self.plot_rect.top)
        nx = np.clip(rel[0] / max(1, self.plot_rect.width), 0, 1)
        ny = np.clip(1.0 - rel[1] / max(1, self.plot_rect.height), 0, 1)
        return lo_w + nx * (hi_w - lo_w), lo_s + ny * (hi_s - lo_s)

    def _local_pos(self, event):
        img = self.plot_image.get_abs_rect()
        return event.pos[0] - img.left, event.pos[1] - img.top

    def process_event(self, event):
        handled = super().process_event(event)
        if event.type == pgui.UI_BUTTON_PRESSED and event.ui_element == self.btn_random:
            self._randomise()
            return True
        if _confirmed(event, self.btn_confirm):
            self._confirm()
            return True
        if event.type == pg.MOUSEBUTTONDOWN and event.button == 1:
            local = self._local_pos(event)
            best, best_d = None, 14 ** 2
            (lo_w, hi_w), (lo_s, hi_s) = WEIGHT, SIGMA
            for i, (_, _w, _s, _) in enumerate(gaussian_dots(self.params)):
                px = self.plot_rect.left + (_w - lo_w) / (hi_w - lo_w) * self.plot_rect.width
                py = self.plot_rect.bottom - (_s - lo_s) / (hi_s - lo_s) * self.plot_rect.height
                d = (local[0] - px) ** 2 + (local[1] - py) ** 2
                if d < best_d:
                    best, best_d = i, d
            if best is not None:
                self.drag = best
                return True
        elif event.type == pg.MOUSEBUTTONUP and event.button == 1:
            self.drag = None
        elif event.type == pg.MOUSEMOTION and self.drag is not None:
            weight, sigma = self._from_px(self._local_pos(event))
            _, wkey, skey, _ = gaussian_pairs()[self.drag]
            self.params[wkey] = weight
            self.params[skey] = sigma
            self.params = clip_params(self.params)
            self.redraw()
            return True
        return handled


def client_row_height(client):
    return 48 if client['cls'] is clients.Gaussian else 26


def score_bar(score, scores, colour, size):
    """Filled bar. The current leader fills the width; the last place is an outline."""
    width, height = size
    surf = pg.Surface((width, height))
    surf.fill((22, 22, 26))
    colour = tuple(int(c) for c in colour[:3])
    lo, hi = min(scores), max(scores)
    span = hi - lo
    frac = 1.0 if span == 0 else (float(score) - lo) / span
    fill = int(round(frac * (width - 2)))
    if fill > 0:
        pg.draw.rect(surf, colour, (1, 1, fill, max(1, height - 2)))
    pg.draw.rect(surf, colour, (0, 0, width, height), 1)
    return surf


def row_frame(size, fill, border):
    surf = pg.Surface(size)
    surf.fill(fill)
    pg.draw.rect(surf, tuple(int(c) for c in border[:3]), surf.get_rect(), 1)
    return surf


def roster_chip(size, selected):
    surf = pg.Surface(size)
    if selected:
        surf.fill((20, 110, 220))
        w, h = size
        pts = [
            (int(w * 0.22), int(h * 0.52)),
            (int(w * 0.40), int(h * 0.74)),
            (int(w * 0.80), int(h * 0.26)),
        ]
        pg.draw.lines(surf, (255, 255, 255), False, pts, max(2, h // 8))
    else:
        surf.fill((42, 42, 48))
        pg.draw.rect(surf, (90, 90, 98), surf.get_rect(), 1)
    return surf


def _tint(colour, amount=0.55):
    colour = tuple(int(c) for c in colour[:3])
    base = (36, 36, 42)
    return tuple(int(base[i] * (1 - amount) + colour[i] * amount) for i in range(3))


def add_client_preview(container, manager, client, rect):
    """Same row body as the set: graph for Gaussian, name otherwise."""
    if client['cls'] is clients.Gaussian:
        thumb = pg.Surface(rect.size)
        draw_weight_sigma_graph(thumb, [plot_candidate(client['kwargs'])], labels=False)
        return pgui.elements.UIImage(rect, thumb, manager, container=container)
    params = ", ".join(f"{k}={v}" for k, v in client['kwargs'].items())
    text = f"{client['name']}" + (f" ({params})" if params else "")
    return pgui.elements.UILabel(rect, text, manager, container=container)


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
        self.catalog = Catalog()
        self.selected_clients = []
        self.roster = set()
        self.play_clients = []
        self.process = None
        self.colors = []
        self._error_window = None
        self.optimizer = None
        self._training = False
        self._stop_train = False
        self._watch_full_paint = True
        self.train_generation = 0
        self.train_candidates = []
        self.bracket = None
        self._bracket_image = None

        self.graph_history = []
        self.match_rows = []
        self._printed_results = False

        self._reload_set()
        self.roster = {client.get('id') for client in self.selected_clients if client.get('id') is not None}
        self.setup_ui()
        self.resize()
        self._refresh_game_button()

    def setup_ui(self):
        self.panel_width = 320
        self.panel = pgui.elements.UIPanel(
            pg.Rect(0, 0, self.panel_width, self.height),
            manager=self.manager,
            anchors={'left': 'left', 'right': 'left', 'top': 'top', 'bottom': 'bottom'}
        )

        pgui.elements.UILabel(pg.Rect(10, 10, 280, 20), "Select Client Class:", self.manager, container=self.panel)
        self.dropdown = pgui.elements.UIDropDownMenu(
            list(self.available_classes.keys()), list(self.available_classes.keys())[0],
            pg.Rect(10, 30, 280, 30), self.manager, container=self.panel
        )
        self.btn_add = pgui.elements.UIButton(pg.Rect(10, 65, 280, 32), "Configure & Add", self.manager, container=self.panel)

        self.set_scroll = _scroll(pg.Rect(10, 105, 300, 200), self.manager, self.panel)
        self._set_widgets = []
        self._set_remove = {}
        self._set_select = {}
        self._set_edit = {}
        self._score_bars = {}
        self._row_frames = {}
        self._set_order_ids = None
        self._hover_hunter = None
        self._hover_prey_ids = set()
        self._hover_colour = (255, 255, 255)

        bot_anchor = {'left': 'left', 'right': 'left', 'top': 'bottom', 'bottom': 'bottom'}

        self.btn_clear = pgui.elements.UIButton(pg.Rect(10, -110, 280, 32), "Clear Set", self.manager, container=self.panel, anchors=bot_anchor)
        self.btn_game = pgui.elements.UIButton(pg.Rect(10, -70, 280, 32), "Start Game", self.manager, container=self.panel, anchors=bot_anchor)
        self.btn_train = pgui.elements.UIButton(pg.Rect(10, -35, 280, 32), "Start Train", self.manager, container=self.panel, anchors=bot_anchor)
        self.update_set_display()

    def instantiate_client(self, cls, grid_size, kwargs):
        sig = inspect.signature(cls.__init__)
        call_kwargs = dict(kwargs)
        call_kwargs.pop('visualize', None)
        if cls is clients.Gaussian:
            call_kwargs['visualize'] = False
        grid_param = next((p for p in sig.parameters if p.lower() in ('gridsize', 'grid_size', 'size')), None)
        if grid_param:
            call_kwargs[grid_param] = grid_size
            return cls(**call_kwargs)
        try:
            return cls(grid_size, **call_kwargs)
        except TypeError:
            return cls(**call_kwargs)

    def _reload_set(self):
        self.selected_clients = self.catalog.visible_clients(self.available_classes)
        live = {client.get('id') for client in self.selected_clients if client.get('id') is not None}
        self.roster = {gid for gid in self.roster if gid in live}
        if hasattr(self, 'set_scroll'):
            self.update_set_display()

    def add_client_callback(self, name, cls, kwargs):
        gid = self.catalog.add_genome(name, kwargs)
        self.roster.add(gid)
        self._reload_set()

    def edit_client_callback(self, idx, name, cls, kwargs):
        if not (0 <= idx < len(self.selected_clients)):
            return
        gid = self.selected_clients[idx].get('id')
        if gid:
            self.catalog.update_genome(gid, name, kwargs)
        else:
            self.catalog.add_genome(name, kwargs)
        self._reload_set()

    def _open_client_config(self, idx, adding=False):
        if adding:
            name = self.dropdown.selected_option
            name = name[0] if isinstance(name, tuple) else name
            cls = self.available_classes[name]
            callback = self.add_client_callback
            kwargs = None
            confirm = None
        else:
            if not (0 <= idx < len(self.selected_clients)):
                return
            client = self.selected_clients[idx]
            name, cls, kwargs = client['name'], client['cls'], client['kwargs']
            callback = lambda n, c, k, i=idx: self.edit_client_callback(i, n, c, k)
            confirm = 'Save'
        if cls is clients.Gaussian:
            GaussianConfigWindow(
                self.manager, callback, (self.width, self.height),
                params=kwargs, confirm_label=confirm,
            )
        else:
            ClientSettingsWindow(
                self.manager, name, cls, callback, (self.width, self.height),
                values=kwargs, confirm_label=confirm,
            )

    def _refresh_game_button(self):
        if not hasattr(self, 'btn_game'):
            return
        if self.process:
            self.btn_game.set_text('Stop Game')
            self.btn_game.enable()
            return
        if legal_match_count(len(self._roster_clients())):
            self.btn_game.set_text('Start Game')
            self.btn_game.enable()
        else:
            self.btn_game.set_text('Start game (must be odd)')
            self.btn_game.disable()

    def _roster_clients(self):
        return [client for client in self.selected_clients if client.get('id') in self.roster]

    def _close_popups(self):
        self.manager.ui_window_stack.clear()
        self._error_window = None

    def _request_start_game(self):
        roster = self._roster_clients()
        if not legal_match_count(len(roster)):
            return
        self._close_popups()
        self._start_game(roster)

    def _toggle_roster(self, gid, image):
        if gid in self.roster:
            self.roster.discard(gid)
        else:
            self.roster.add(gid)
        image.set_image(roster_chip(image.image.get_size(), gid in self.roster).convert())
        self._refresh_game_button()

    def _start_game(self, roster=None):
        roster = list(roster or self._roster_clients())
        if not legal_match_count(len(roster)):
            return
        self.play_clients = roster
        instances = [self.instantiate_client(c['cls'], self.gridSize, c['kwargs']) for c in roster]
        self.colors = generate_colours(len(instances))
        self.process = Game(instances, [SWARMSIZE] * len(instances), self.colors, self.gridSize)
        self.graph_history.clear()
        self.match_rows = self.process.metrics()
        self._printed_results = False
        self.train_candidates = []
        self.bracket = None
        self._bracket_image = None
        self.update_set_display()

    def _stop_game(self):
        self.process = None
        self.colors = []
        self.play_clients = []
        self.match_rows = []
        self._hover_hunter = None
        self._hover_prey_ids = set()
        self.update_set_display()

    def _report_error(self, exc):
        if self._error_window is not None and self._error_window.alive():
            return
        detail = html.escape(''.join(traceback.format_exception(exc))).replace('\n', '<br>')
        w, h = min(640, max(280, self.width - 80)), min(360, max(180, self.height - 80))
        rect = pg.Rect((self.width - w) // 2, (self.height - h) // 2, w, h)
        self._error_window = UIMessageWindow(
            rect, detail, self.manager, window_title=type(exc).__name__,
        )

    def _start_train(self):
        self._close_popups()
        self._stop_game()
        self.train_candidates = []
        self.train_generation = 0
        self._stop_train = False
        self._watch_full_paint = True
        self.bracket = None
        self._bracket_image = None
        seeds = [
            client['id'] for client in self._roster_clients()
            if client['cls'] is clients.Gaussian and client.get('id') is not None
        ]
        self.optimizer = Optimizer(
            self.catalog,
            visualize=self._show_training_games,
            on_bracket=self._show_bracket,
            on_population=self._show_population,
            stop=self._train_should_stop,
            seeds=seeds,
        )
        self._training = True
        self.btn_add.disable()
        self.btn_clear.disable()
        self.btn_game.disable()
        self.btn_train.enable()
        self.btn_train.set_text('Stop Train')

    def _train_should_stop(self):
        return self._stop_train

    def _request_stop_train(self):
        if not self._training or self._stop_train:
            return
        self._stop_train = True
        self.btn_train.set_text('Stopping...')
        self.btn_train.disable()

    def _end_train(self):
        stopped = self._stop_train
        self._training = False
        self._stop_train = False
        if self.optimizer is not None:
            shown = list(self.optimizer.archive)
            if not stopped and not shown:
                shown = list(self.optimizer.population)
            for gid in shown:
                self.catalog.show(gid)
            if shown:
                self._reload_set()
        self.btn_add.enable()
        self.btn_clear.enable()
        self.btn_train.enable()
        self.btn_train.set_text('Start Train')
        self._refresh_game_button()

    def _train_step(self):
        if self._stop_train:
            self._end_train()
            return
        self.train_generation = self.train_generation + 1
        total = self.optimizer.generations
        self.btn_train.set_text('Stop Train ' + str(self.train_generation) + '/' + str(total))
        self._watch_full_paint = True
        try:
            scores = self.optimizer.step()
        except TrainingStopped:
            self._end_train()
            return
        ranked = sorted(scores, key=lambda gid: scores[gid], reverse=True)
        candidates = []
        for gid in ranked:
            params = self.catalog.genome(gid)
            candidates.append(plot_candidate(params))
        self.train_candidates = candidates
        self._paint_overlay()
        pg.display.update(self.overlay_rect)
        if self._stop_train or self.train_generation >= self.optimizer.generations:
            self._end_train()

    def _score_by_id(self):
        if not self.process:
            return {}
        scores = {}
        for row in self.match_rows:
            slot = int(row['swarm'])
            if slot < len(self.play_clients):
                gid = self.play_clients[slot].get('id')
                if gid is not None:
                    scores[gid] = float(row['score'])
        return scores

    def _colour_by_id(self):
        return {
            client.get('id'): colour
            for client, colour in zip(self.play_clients, self.colors)
            if client.get('id') is not None
        } if self.process else {}

    def _display_order(self):
        scores = self._score_by_id()
        if not scores:
            return list(enumerate(self.selected_clients))
        playing, rest = [], []
        for idx, client in enumerate(self.selected_clients):
            if client.get('id') in scores:
                playing.append((idx, client))
            else:
                rest.append((idx, client))
        playing.sort(key=lambda item: (-scores[item[1]['id']], item[0]))
        return playing + rest

    def _sync_set(self):
        order = [client.get('id') for _, client in self._display_order()]
        if order != self._set_order_ids:
            self.update_set_display()
            return
        self._paint_score_bars()

    def _frame_style(self, gid):
        own = self._colour_by_id().get(gid)
        border = own if own is not None else (110, 110, 118)
        if gid in self._hover_prey_ids:
            fill = _tint(self._hover_colour)
        else:
            fill = (28, 28, 32)
        return fill, border

    def _paint_row_frames(self):
        for gid, image in self._row_frames.items():
            if not image.alive():
                continue
            fill, border = self._frame_style(gid)
            image.set_image(row_frame(image.image.get_size(), fill, border).convert())

    def _update_prey_hover(self, pos):
        hunter = None
        if self.process:
            for gid, image in self._row_frames.items():
                if gid not in self._colour_by_id() or not image.alive():
                    continue
                if image.get_abs_rect().collidepoint(pos):
                    hunter = gid
                    break
        if hunter == self._hover_hunter:
            return
        self._hover_hunter = hunter
        self._hover_prey_ids = set()
        self._hover_colour = (255, 255, 255)
        if hunter is not None:
            slot = next(i for i, client in enumerate(self.play_clients) if client.get('id') == hunter)
            self._hover_colour = self.colors[slot]
            self._hover_prey_ids = {
                self.play_clients[j].get('id') for j in self.process.prey_of[slot]
            }
        self._paint_row_frames()

    def _paint_score_bars(self):
        scores = self._score_by_id()
        if not scores:
            return
        colours = self._colour_by_id()
        values = list(scores.values())
        for gid, image in self._score_bars.items():
            if gid not in scores or not image.alive():
                continue
            image.set_image(score_bar(
                scores[gid], values, colours.get(gid, (200, 200, 200)), image.image.get_size(),
            ).convert())

    def update_set_display(self):
        for widget in self._set_widgets:
            widget.kill()
        self._set_widgets = []
        self._set_remove = {}
        self._set_select = {}
        self._set_edit = {}
        self._score_bars = {}
        self._row_frames = {}
        y = 4
        if not self.selected_clients:
            empty = pgui.elements.UILabel(
                pg.Rect(4, y, 250, 24), "Set: none", self.manager, container=self.set_scroll
            )
            self._set_widgets.append(empty)
            _set_scroll_h(self.set_scroll, 80)
            self._set_order_ids = []
            self._refresh_game_button()
            return
        scores = self._score_by_id()
        colours = self._colour_by_id()
        values = list(scores.values())
        pad, card_w, bar_w, btn_w = 4, 276, 56, 26
        left_x = pad + 2
        right_x = card_w - pad - btn_w
        inner_x = left_x + btn_w + 4
        inner_w = right_x - 4 - inner_x
        body_w = inner_w - bar_w - 4 if scores else inner_w
        for idx, client in self._display_order():
            gid = client.get('id')
            colour = colours.get(gid, (200, 200, 200))
            row_h = client_row_height(client)
            card_h = row_h + pad * 2
            fill, border = self._frame_style(gid)
            frame = pgui.elements.UIImage(
                pg.Rect(0, y, card_w, card_h),
                row_frame((card_w, card_h), fill, border).convert(),
                self.manager, container=self.set_scroll, starting_height=0,
            )
            self._row_frames[gid] = frame
            self._set_widgets.append(frame)
            select = pgui.elements.UIImage(
                pg.Rect(left_x, y + pad, btn_w, 26),
                roster_chip((btn_w, 26), gid in self.roster).convert(),
                self.manager, container=self.set_scroll,
            )
            self._set_select[select] = gid
            self._set_widgets.append(select)
            preview = add_client_preview(
                self.set_scroll, self.manager, client, pg.Rect(inner_x, y + pad, body_w, row_h),
            )
            self._set_edit[preview] = idx
            self._set_widgets.append(preview)
            if gid in scores:
                bar = pgui.elements.UIImage(
                    pg.Rect(inner_x + body_w + 4, y + pad, bar_w, row_h),
                    score_bar(scores[gid], values, colour, (bar_w, row_h)).convert(),
                    self.manager, container=self.set_scroll,
                )
                self._score_bars[gid] = bar
                self._set_widgets.append(bar)
            remove = pgui.elements.UIButton(
                pg.Rect(right_x, y + pad, btn_w, 26), "X", self.manager, container=self.set_scroll
            )
            self._set_remove[remove] = idx
            self._set_widgets.append(remove)
            y += card_h + 4
        _set_scroll_h(self.set_scroll, y + 8)
        self._set_order_ids = [client.get('id') for _, client in self._display_order()]
        self._refresh_game_button()

    def resize(self):
        self.manager.set_window_resolution((self.width, self.height))
        self.panel.set_dimensions((self.panel_width, self.height))
        self.set_scroll.set_dimensions((300, max(100, self.height - 235)))

        visual_w = self.width - self.panel_width
        sim_h = int(self.height * 0.65)
        bottom_h = self.height - sim_h
        overlay = min(bottom_h, visual_w // 3)

        self.sim_rect = pg.Rect(self.panel_width, 0, visual_w, sim_h)
        self.graph_rect = pg.Rect(self.panel_width, sim_h, max(8, visual_w - overlay), bottom_h)
        self.overlay_rect = pg.Rect(self.width - overlay, sim_h, overlay, overlay)

        scale = min((self.sim_rect.width - self.margin) / self.gridWidth, (self.sim_rect.height - self.margin) / self.gridHeight)
        self.contentSize = (int(self.gridWidth * scale), int(self.gridHeight * scale))
        self.contentPos = (
            self.sim_rect.left + (self.sim_rect.width - self.contentSize[0]) // 2,
            self.sim_rect.top + (self.sim_rect.height - self.contentSize[1]) // 2
        )

    def _draw_game_grid(self, tiles):
        """Lay job tiles out in a square. The side is ceil(sqrt(jobs))."""
        n = 0 if tiles is None else len(tiles)
        if n == 0:
            pg.draw.rect(self.screen, BACKGROUND, self.sim_rect)
            return
        snap = np.array(tiles, copy=True)
        side = math.ceil(math.sqrt(n))
        tw = snap.shape[1]
        th = snap.shape[2]
        gap = 2
        span = side * tw + (side + 1) * gap
        mosaic = np.empty((span, span, 3), dtype=np.uint8)
        mosaic[:] = BACKGROUND
        for index in range(side * side):
            col = index % side
            row = index // side
            x0 = gap + col * (tw + gap)
            y0 = gap + row * (th + gap)
            mosaic[x0:x0 + tw, y0:y0 + th] = 0
        for index in range(n):
            col = index % side
            row = index // side
            x0 = gap + col * (tw + gap)
            y0 = gap + row * (th + gap)
            mosaic[x0:x0 + tw, y0:y0 + th] = snap[index]
        surf = pg.surfarray.make_surface(mosaic)
        area = self.sim_rect
        fit = max(1, min(area.width, area.height) - 8)
        scaled = pg.transform.scale(surf, (fit, fit))
        pg.draw.rect(self.screen, BACKGROUND, area)
        self.screen.blit(scaled, scaled.get_rect(center=area.center))

    def _present(self, tiles=None):
        self.screen.fill((50, 50, 50))
        if tiles is not None:
            self._draw_game_grid(tiles)
        else:
            self.screen.blit(pg.transform.scale(self.content, self.contentSize), self.contentPos)
        self.draw_graph()
        self.manager.draw_ui(self.screen)
        pg.display.flip()

    def _is_quit(self, event):
        return event.type in (pg.QUIT, pg.WINDOWCLOSE)

    def _pump_training_events(self):
        for event in pg.event.get():
            if self._is_quit(event):
                raise SystemExit
            if event.type == pg.VIDEORESIZE:
                self.width, self.height = event.w, event.h
                self.resize()
                self._watch_full_paint = True
            elif event.type == pgui.UI_BUTTON_PRESSED and event.ui_element == self.btn_train:
                self._request_stop_train()
            self.manager.process_events(event)

    def _show_training_games(self, tiles):
        dt = self.clock.tick(60) / 1000.0
        self._pump_training_events()
        if self._watch_full_paint:
            self.manager.update(dt)
            self._present(tiles)
            self._watch_full_paint = False
            return
        self._draw_game_grid(tiles)
        pg.display.update(self.sim_rect)

    def _playing_gaussian_candidates(self):
        if not self.process:
            return []
        out = []
        for client in self.play_clients:
            if client['cls'] is clients.Gaussian:
                out.append(plot_candidate(client['kwargs']))
        return out

    def draw_graph(self):
        if self.bracket:
            self._ensure_bracket_image()
            self.screen.blit(self._bracket_image, self.graph_rect.topleft)
        else:
            pg.draw.rect(self.screen, (30, 30, 30), self.graph_rect)
            pg.draw.rect(self.screen, (100, 100, 100), self.graph_rect, 2)

        if self.graph_history and not self.bracket:
            history = np.asarray(self.graph_history, dtype=np.float32)
            num_graphs = history.shape[1] if history.ndim > 1 else 1
            min_y, max_y = 0.0, float(np.max(history))
            range_y = (max_y - min_y) if max_y != min_y else 1.0
            pad = 10
            draw_w = self.graph_rect.width - (pad * 2)
            draw_h = self.graph_rect.height - (pad * 2)
            span = max(1, MAX_STEPS - 1)
            for i in range(num_graphs):
                color = self.colors[i % len(self.colors)] if self.colors else (255, 255, 255)
                y_data = history[:, i] if history.ndim > 1 else history
                points = []
                for x_idx, y_val in enumerate(y_data):
                    px = self.graph_rect.left + pad + (x_idx / span) * draw_w
                    py = self.graph_rect.bottom - pad - ((float(y_val) - min_y) / range_y) * draw_h
                    points.append((int(px), int(py)))
                if len(points) > 1:
                    pg.draw.lines(self.screen, tuple(int(c) for c in color[:3]), False, points, 2)

        self._paint_overlay()

    def _overlay_candidates(self):
        return self.train_candidates or self._playing_gaussian_candidates()

    def _paint_overlay(self):
        pg.draw.rect(self.screen, (30, 30, 30), self.overlay_rect)
        pg.draw.rect(self.screen, (100, 100, 100), self.overlay_rect, 2)
        candidates = self._overlay_candidates()
        if not candidates:
            return
        plot = self.screen.subsurface(self.overlay_rect.inflate(-4, -4))
        draw_weight_sigma_graph(plot, candidates, labels=False)

    def _show_population(self, ids):
        """Parameter square for the genomes about to play this tournament."""
        candidates = []
        for gid in ids:
            try:
                params = self.catalog.genome(gid)
            except KeyError:
                continue
            candidates.append(plot_candidate(params))
        self.train_candidates = candidates
        self._paint_overlay()
        pg.display.update(self.overlay_rect)

    def _ensure_bracket_image(self):
        size = self.graph_rect.size
        if self._bracket_image is not None and self._bracket_image.get_size() == size:
            return
        self._bracket_image = pg.Surface(size)
        draw_bracket(self._bracket_image, self.bracket, TOURNAMENT_ROUNDS, self._genotype_colours())

    def _genotype_colours(self):
        colours = {}
        for column in self.bracket or []:
            for match in column:
                for gid, _pts in match:
                    if gid in colours:
                        continue
                    try:
                        colours[gid] = strategy_gradient(self.catalog.genome(gid))
                    except KeyError:
                        colours[gid] = ((200, 200, 200), (200, 200, 200))
        return colours

    def _show_bracket(self, seating):
        self.bracket = seating
        self._bracket_image = None
        self._watch_full_paint = True
        self._ensure_bracket_image()
        self.screen.blit(self._bracket_image, self.graph_rect.topleft)
        pg.display.update(self.graph_rect)

    def _frame(self, dt, accumulator):
        for event in pg.event.get():
            if self._is_quit(event):
                return False, accumulator
            if event.type == pg.VIDEORESIZE:
                self.width, self.height = event.w, event.h
                self.resize()

            elif event.type == pg.MOUSEMOTION:
                self._update_prey_hover(event.pos)

            elif event.type == pg.MOUSEBUTTONDOWN and event.button == 1 and not self._training:
                hit = False
                for widget, gid in self._set_select.items():
                    if widget.alive() and widget.get_abs_rect().collidepoint(event.pos):
                        self._toggle_roster(gid, widget)
                        hit = True
                        break
                if not hit:
                    for widget, idx in self._set_edit.items():
                        if widget.alive() and widget.get_abs_rect().collidepoint(event.pos):
                            self._open_client_config(idx)
                            break

            elif event.type == pgui.UI_BUTTON_PRESSED and event.ui_element in self._set_remove and not self._training:
                idx = self._set_remove[event.ui_element]
                if 0 <= idx < len(self.selected_clients):
                    gid = self.selected_clients[idx].get('id')
                    if gid:
                        self.catalog.hide(gid)
                    self._reload_set()

            elif event.type == pgui.UI_BUTTON_PRESSED:
                if event.ui_element == self.btn_add:
                    self._open_client_config(0, adding=True)

                elif event.ui_element == self.btn_clear:
                    self.catalog.hide_visible()
                    self._reload_set()

                elif event.ui_element == self.btn_game:
                    if self.process:
                        self._stop_game()
                    else:
                        self._request_start_game()

                elif event.ui_element == self.btn_train:
                    if self._training:
                        self._request_stop_train()
                    else:
                        self._start_train()

            self.manager.process_events(event)

        self.manager.update(dt)
        accumulator += dt

        if accumulator >= self.stepTime:
            if self.process and not self._printed_results:
                try:
                    out = self.process.step()
                    self.content.fill("Black")
                    self.process.draw(self.content)
                    self.graph_history.append([
                        0 if swarm.positions.size == 0 else len(swarm.positions)
                        for swarm in self.process.swarms
                    ])
                    rows = out if out is not None else self.process.metrics()
                    self.match_rows = rows
                    self._sync_set()
                    if out is not None or len(self.graph_history) >= MAX_STEPS:
                        self.catalog.record_match(
                            self.play_clients, rows, MAX_STEPS, SWARMSIZE,
                        )
                        self._reload_set()
                        self._printed_results = True
                except Exception as exc:
                    self._report_error(exc)
                    self._printed_results = True
            accumulator -= self.stepTime

        if self._training:
            try:
                self._train_step()
            except Exception as exc:
                self._stop_train = False
                self._training = False
                self.btn_add.enable()
                self.btn_clear.enable()
                self.btn_train.enable()
                self.btn_train.set_text('Start Train')
                self._refresh_game_button()
                self._report_error(exc)
        if not self._training:
            self._present()
        return True, accumulator

    def run(self):
        accumulator = 0.0
        running = True
        aborted = False
        try:
            while running:
                dt = self.clock.tick(60) / 1000
                try:
                    running, accumulator = self._frame(dt, accumulator)
                except SystemExit:
                    aborted = True
                    running = False
                except Exception as exc:
                    self._report_error(exc)
        finally:
            pg.quit()
        if aborted:
            os._exit(0)
