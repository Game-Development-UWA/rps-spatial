import numpy as np

from settings import *

class Client:
  def __init__(self):
    pass

  def __str__(self):
    name = type(self).__name__
    params = vars(self)
    if not params:
      return name
    return f"{name}({', '.join(f'{k}={v}' for k, v in params.items())})"

  def __repr__(self):
    return str(self)

  def getResponse(self, poses, preyposes, predposes):

    return np.random.randint(- 1, 2, size=(len(poses), 2))

class Simple(Client):
  def __init__(self):
    super().__init__()

  def getResponse(self, poses, preyposes, predposes):
    preycentre = np.mean(preyposes, axis=0)
    predcentre = np.mean(predposes, axis=0)

    attraction = preycentre - poses
    repulsion = poses - predcentre

    a = np.linalg.norm(attraction, axis=1, keepdims=True)
    r = np.linalg.norm(repulsion, axis=1, keepdims=True)

    aspread = np.std(preyposes, axis=0).mean()
    rspread = np.std(predposes, axis=0).mean()

    aspread = 1.0 if aspread == 0.0 else aspread
    rspread = 1.0 if rspread == 0.0 else rspread

    # NaN protection because centre's np.mean(empty array) can lead to NaN
    poses = (np.nan_to_num(attraction / a / a / aspread)
             + np.nan_to_num(repulsion / r / r / rspread))

    norms = np.linalg.norm(poses, axis=1, keepdims=True)
    norms[norms == 0] = 1

    velocities = np.round(poses / norms).astype(int)
    return velocities

class Smple(Client):
  def __init__(self, fear):
    super().__init__()
    self.fear = fear

  def getResponse(self, poses, preyposes, predposes):
    preycentre = np.mean(preyposes, axis=0)
    predcentre = np.mean(predposes, axis=0)

    attraction = preycentre - poses
    repulsion = poses - predcentre

    a = np.linalg.norm(attraction, axis=1, keepdims=True)
    r = np.linalg.norm(repulsion, axis=1, keepdims=True)

    aspread = np.std(preyposes, axis=0).mean()
    rspread = np.std(predposes, axis=0).mean()

    aspread = 1.0 if aspread == 0.0 else aspread
    rspread = 1.0 if rspread == 0.0 else rspread

    # NaN protection because centre's np.mean(empty array) can lead to NaN
    poses = (np.nan_to_num((1 - self.fear) * attraction / a / a / aspread)
             + np.nan_to_num(self.fear * repulsion / r / r / rspread))

    norms = np.linalg.norm(poses, axis=1, keepdims=True)
    norms[norms == 0] = 1

    velocities = np.round(poses / norms).astype(int)
    return velocities

class Simple2(Client):
  def __init__(self):
    super().__init__()

  def _get_nearest_forces(self, poses, targets, is_attraction=True):
    if len(targets) == 0 or len(poses) == 0:
      return np.zeros_like(poses, dtype=float)

    forces = np.zeros_like(poses, dtype=float)
    
    # 60px cell size on 1200px grid = 20x20 cell grid
    cell_size = 60
    grid_dim = (GRIDSIZE + cell_size - 1) // cell_size
    num_cells = grid_dim * grid_dim

    # Map 2D coordinates to 1D cell IDs
    p_keys = (np.clip(poses[:, 1] // cell_size, 0, grid_dim - 1) * grid_dim + 
              np.clip(poses[:, 0] // cell_size, 0, grid_dim - 1)).astype(int)
    t_keys = (np.clip(targets[:, 1] // cell_size, 0, grid_dim - 1) * grid_dim + 
              np.clip(targets[:, 0] // cell_size, 0, grid_dim - 1)).astype(int)

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

      cy, cx = divmod(cell_key, grid_dim)

      # Slice target arrays from the 3x3 neighboring grid cells
      neighbor_slices = []
      for ny in range(max(0, cy - 1), min(grid_dim, cy + 2)):
        for nx in range(max(0, cx - 1), min(grid_dim, cx + 2)):
          nk = ny * grid_dim + nx
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

      norms = np.linalg.norm(forces, axis=1, keepdims=True)
      zero_forces = (norms == 0)
      norms[zero_forces] = 1.0

      velocities = np.round(forces / norms).astype(int)
      velocities[zero_forces.squeeze()] = 0

      return velocities
