import inspect
import numpy as np
from scipy.ndimage import gaussian_filter

# 8-neighbour steps only: including (0, 0) freezes units on any local peak.
_GRAD_DX = np.array([-1, -1, -1,  0, 0,  1, 1, 1], dtype=int)
_GRAD_DY = np.array([-1,  0,  1, -1, 1, -1, 0, 1], dtype=int)


class Client:
    def __init__(self, gridSize=None):
        if isinstance(gridSize, (int, float)):
            self.gridSize = (int(gridSize), int(gridSize))
        elif gridSize is not None:
            self.gridSize = (int(gridSize[0]), int(gridSize[1]))
        else:
            self.gridSize = None

    def __str__(self):
        name = type(self).__name__
        parts = []
        for pname, param in inspect.signature(type(self).__init__).parameters.items():
            if pname == 'self' or param.kind in (param.VAR_POSITIONAL, param.VAR_KEYWORD):
                continue
            parts.append(f'{pname}={getattr(self, pname, None)}')
        if not parts:
            return name
        return f"{name}({', '.join(parts)})"

    def __repr__(self):
        return str(self)

    def getResponse(self, poses, preyposes, predposes):
        return np.random.randint(-1, 2, size=(len(poses), 2))


def _spread(positions):
    s = np.std(positions, axis=0).mean()
    return 1.0 if s == 0.0 else s


def _unit_steps(vectors):
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1
    return np.round(vectors / norms).astype(int)


class Smple(Client):
    def __init__(self, fear=0.5, gridSize=None):
        super().__init__(gridSize)
        self.fear = fear

    def getResponse(self, poses, preyposes, predposes):
        attraction = np.mean(preyposes, axis=0) - poses
        repulsion = poses - np.mean(predposes, axis=0)
        a = np.linalg.norm(attraction, axis=1, keepdims=True)
        r = np.linalg.norm(repulsion, axis=1, keepdims=True)
        # NaN protection: empty-side np.mean is NaN
        force = (
            np.nan_to_num((1 - self.fear) * attraction / a / a / _spread(preyposes))
            + np.nan_to_num(self.fear * repulsion / r / r / _spread(predposes))
        )
        return _unit_steps(force)


class Simple(Smple):
    def __init__(self, gridSize=None):
        super().__init__(fear=0.5, gridSize=gridSize)


class Simple2(Client):
    def __init__(self, gridSize=(1200, 1200)):
        super().__init__(gridSize)

    def _get_nearest_forces(self, poses, targets, is_attraction=True):
        if len(targets) == 0 or len(poses) == 0:
            return np.zeros_like(poses, dtype=float)

        forces = np.zeros_like(poses, dtype=float)
        width, height = self.gridSize if self.gridSize else (1200, 1200)

        # Spatial binning over 2D rectangular grid
        cell_size = 60
        grid_dim_x = max(1, (width + cell_size - 1) // cell_size)
        grid_dim_y = max(1, (height + cell_size - 1) // cell_size)
        num_cells = grid_dim_x * grid_dim_y

        # Map 2D coordinates to 1D spatial hash keys
        p_x = np.clip(poses[:, 0] // cell_size, 0, grid_dim_x - 1).astype(int)
        p_y = np.clip(poses[:, 1] // cell_size, 0, grid_dim_y - 1).astype(int)
        p_keys = p_y * grid_dim_x + p_x

        t_x = np.clip(targets[:, 0] // cell_size, 0, grid_dim_x - 1).astype(int)
        t_y = np.clip(targets[:, 1] // cell_size, 0, grid_dim_y - 1).astype(int)
        t_keys = t_y * grid_dim_x + t_x

        # Vectorized target bucket sorting via searchsorted
        t_order = np.argsort(t_keys)
        sorted_t_keys = t_keys[t_order]
        sorted_targets = targets[t_order]

        cell_starts = np.searchsorted(sorted_t_keys, np.arange(num_cells), side='left')
        cell_ends = np.searchsorted(sorted_t_keys, np.arange(num_cells), side='right')

        # Group poses by cell ID to process contiguous memory blocks
        p_order = np.argsort(p_keys)
        sorted_p_keys = p_keys[p_order]
        sorted_poses = poses[p_order]

        p_cell_starts = np.searchsorted(sorted_p_keys, np.arange(num_cells), side='left')
        p_cell_ends = np.searchsorted(sorted_p_keys, np.arange(num_cells), side='right')

        target_centroid = np.mean(targets, axis=0)
        active_cells = np.where(p_cell_starts < p_cell_ends)[0]

        for cell_key in active_cells:
            p_start = p_cell_starts[cell_key]
            p_end = p_cell_ends[cell_key]
            cell_poses = sorted_poses[p_start:p_end]

            cy, cx = divmod(cell_key, grid_dim_x)

            # Slice target arrays from the 3x3 neighboring grid cells
            neighbor_slices = []
            for ny in range(max(0, cy - 1), min(grid_dim_y, cy + 2)):
                for nx in range(max(0, cx - 1), min(grid_dim_x, cx + 2)):
                    nk = ny * grid_dim_x + nx
                    if cell_starts[nk] < cell_ends[nk]:
                        neighbor_slices.append(sorted_targets[cell_starts[nk]:cell_ends[nk]])

            if neighbor_slices:
                cell_targets = np.vstack(neighbor_slices)

                # Compute local distance matrix for nearby units only
                poses_sq = np.sum(cell_poses**2, axis=1, keepdims=True)
                targets_sq = np.sum(cell_targets**2, axis=1)
                dists_sq = poses_sq + targets_sq - 2 * np.dot(cell_poses, cell_targets.T)
                np.clip(dists_sq, 0, None, out=dists_sq)

                nearest_idx = np.argmin(dists_sq, axis=1)
                nearest_targets = cell_targets[nearest_idx]
                dists = np.sqrt(dists_sq[np.arange(len(cell_poses)), nearest_idx])[:, np.newaxis]

                vec = (nearest_targets - cell_poses) if is_attraction else (cell_poses - nearest_targets)

                zero_mask = (dists.ravel() == 0)
                if np.any(zero_mask):
                    vec[zero_mask] = np.random.uniform(-1, 1, size=(np.sum(zero_mask), 2))
                    dists[zero_mask] = 1e-3

                forces[p_order[p_start:p_end]] = vec / (dists**3)
            else:
                # Fall back to centroid force for isolated units
                vec = (target_centroid - cell_poses) if is_attraction else (cell_poses - target_centroid)
                dists = np.linalg.norm(vec, axis=1, keepdims=True)
                dists[dists == 0] = 1e-3
                forces[p_order[p_start:p_end]] = vec / (dists**3)

        return forces

    def getResponse(self, poses, preyposes, predposes):
        has_prey = len(preyposes) > 0
        has_pred = len(predposes) > 0

        effective_prey = preyposes if has_prey else predposes
        effective_pred = predposes if has_prey else np.array([])

        forces = np.zeros_like(poses, dtype=float)

        if len(effective_prey) > 0:
            forces += self._get_nearest_forces(poses, effective_prey, is_attraction=True)
        if len(effective_pred) > 0:
            forces += self._get_nearest_forces(poses, effective_pred, is_attraction=False)

        velocities = _unit_steps(forces)
        velocities[np.linalg.norm(forces, axis=1) == 0] = 0
        return velocities


class Gaussian(Client):
    """Smoothed field: chase prey, flee predators, spread locally.

    Occupancy is binned into `cell`×`cell` world pixels, blurred with scipy,
    then each unit steps toward the neighbouring cell with the highest value.
    """

    def __init__(
        self,
        gridSize=(1200, 1200),
        prey_weight=1.0,
        pred_weight=1.6,
        prey_sigma=4.0,
        pred_sigma=10.0,
        self_weight=0.0,
        self_sigma=0.0,
        sep_weight=2.0,
        sep_sigma=1.0,
        cell=2,
        visualize=False,
    ):
        super().__init__(gridSize)
        self.prey_weight = prey_weight
        self.pred_weight = pred_weight
        self.prey_sigma = prey_sigma
        self.pred_sigma = pred_sigma
        self.self_weight = self_weight
        self.self_sigma = self_sigma
        self.sep_weight = sep_weight
        self.sep_sigma = sep_sigma
        self.cell = max(1, int(cell))
        self.visualize = visualize
        self._init_buffers()

    def _init_buffers(self):
        width, height = self.gridSize if self.gridSize else (1200, 1200)
        self._bins_x = (width + self.cell - 1) // self.cell
        self._bins_y = (height + self.cell - 1) // self.cell
        self._last_x = self._bins_x - 1
        self._last_y = self._bins_y - 1
        shape = (self._bins_x, self._bins_y)
        self._field = np.zeros(shape, dtype=np.float32)
        self._occupancy = np.zeros(shape, dtype=np.float32)
        self._scratch = np.zeros(shape, dtype=np.float32)

    def _bin(self, positions):
        xs = np.clip(positions[:, 0] // self.cell, 0, self._last_x).astype(np.intp, copy=False)
        ys = np.clip(positions[:, 1] // self.cell, 0, self._last_y).astype(np.intp, copy=False)
        return xs, ys

    def _deposit(self, positions, sigma, weight):
        if not weight or len(positions) == 0:
            return
        xs, ys = self._bin(positions)
        counts = np.bincount(ys * self._bins_x + xs, minlength=self._bins_x * self._bins_y)
        occ = counts.reshape((self._bins_y, self._bins_x)).T * weight
        if sigma / self.cell <= 0.35:
            self._field += occ
            return
        self._occupancy[:] = occ
        gaussian_filter(self._occupancy, sigma / self.cell, output=self._scratch, mode='constant', truncate=3.0)
        self._field += self._scratch

    def getResponse(self, poses, preyposes, predposes):
        self._field.fill(0)
        self._deposit(preyposes, self.prey_sigma, self.prey_weight)
        self._deposit(predposes, self.pred_sigma, -self.pred_weight)
        self._deposit(poses, self.self_sigma, self.self_weight)
        self._deposit(poses, self.sep_sigma, -self.sep_weight)
        if self.visualize:
            self._draw_field()

        xs, ys = self._bin(poses)
        dx = xs[:, None] + _GRAD_DX
        dy = ys[:, None] + _GRAD_DY
        vals = self._field[np.clip(dx, 0, self._last_x), np.clip(dy, 0, self._last_y)].copy()
        vals[(dx < 0) | (dx > self._last_x) | (dy < 0) | (dy > self._last_y)] = -np.inf
        vals += np.random.random(vals.shape).astype(np.float32) * 1e-5
        best = vals.argmax(axis=1)
        return np.column_stack((_GRAD_DX[best], _GRAD_DY[best]))

    def _draw_field(self):
        try:
            if getattr(self, '_texture', None) is None:
                import pygame as pg
                from pygame._sdl2.video import Window, Renderer, Texture

                if not pg.get_init():
                    pg.init()
                self._pg = pg
                scale = max(4, 600 // max(self._bins_x, self._bins_y))
                self._window = Window("Gaussian field", size=(self._bins_x * scale, self._bins_y * scale))
                self._renderer = Renderer(self._window)
                self._Texture = Texture
                self._texture = None
        except Exception:
            self.visualize = False
            return

        peak = float(np.max(np.abs(self._field))) or 1.0
        t = np.clip(self._field / peak, -1.0, 1.0)
        pos = np.clip(t, 0.0, 1.0)[..., None]
        neg = np.clip(-t, 0.0, 1.0)[..., None]
        # dark mid, green chase, red flee
        rgb = (
            np.array([22, 24, 32], dtype=np.float32)
            + pos * np.array([40, 200, 70], dtype=np.float32)
            + neg * np.array([220, 40, 50], dtype=np.float32)
        ).astype(np.uint8)
        surf = self._pg.surfarray.make_surface(rgb)
        try:
            if self._texture is None:
                self._texture = self._Texture.from_surface(self._renderer, surf)
            else:
                self._texture.update(surf)
            self._texture.draw()
            self._renderer.present()
        except Exception:
            self.visualize = False
