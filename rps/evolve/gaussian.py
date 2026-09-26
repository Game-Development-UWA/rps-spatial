import inspect

import numpy as np

from .. import clients
from ..settings import MAX_CELLS, MAX_SIGMA, MAX_WEIGHT

GAUSSIAN_DOTS = (
    ('prey', 'prey_weight', 'prey_sigma', (70, 200, 90)),
    ('pred', 'pred_weight', 'pred_sigma', (220, 60, 70)),
    ('grp', 'self_weight', 'self_sigma', (70, 140, 230)),
    ('sep', 'sep_weight', 'sep_sigma', (20, 50, 140)),
)


def gaussian_bounds():
    """Search box owned by the optimiser; GUI reads the same settings values."""
    return {
        'weight': (-MAX_WEIGHT, MAX_WEIGHT),
        'sigma': (0.0, MAX_SIGMA),
        'cell': (1, MAX_CELLS),
    }


def _limits():
    b = gaussian_bounds()
    return b['weight'], b['sigma'], b['cell']


def sample_gaussian_params(rng=None):
    rng = np.random.default_rng() if rng is None else rng
    (lo_w, hi_w), (lo_s, hi_s), (lo_c, hi_c) = _limits()
    params = {}
    for _, wkey, skey, _ in GAUSSIAN_DOTS:
        params[wkey] = float(rng.uniform(lo_w, hi_w))
        params[skey] = float(rng.uniform(lo_s, hi_s))
    params['cell'] = int(rng.integers(lo_c, hi_c + 1))
    return params


def clip_gaussian_params(params):
    (lo_w, hi_w), (lo_s, hi_s), (lo_c, hi_c) = _limits()
    out = dict(params)
    for _, wkey, skey, _ in GAUSSIAN_DOTS:
        if wkey in out:
            out[wkey] = float(np.clip(out[wkey], lo_w, hi_w))
        if skey in out:
            out[skey] = float(np.clip(out[skey], lo_s, hi_s))
    if 'cell' in out:
        out['cell'] = int(np.clip(int(out['cell']), lo_c, hi_c))
    return out


def mutate_gaussian_params(params, rng=None, scale=0.15):
    rng = np.random.default_rng() if rng is None else rng
    (lo_w, hi_w), (lo_s, hi_s), _ = _limits()
    child = dict(params)
    for _, wkey, skey, _ in GAUSSIAN_DOTS:
        child[wkey] = child.get(wkey, 0.0) + rng.normal(0, scale * (hi_w - lo_w))
        child[skey] = child.get(skey, 0.0) + rng.normal(0, scale * (hi_s - lo_s))
    if rng.random() < 0.25:
        child['cell'] = child.get('cell', 2) + int(rng.integers(-2, 3))
    return clip_gaussian_params(child)


def default_gaussian_params():
    sig = inspect.signature(clients.Gaussian.__init__)
    params = {}
    for name, param in sig.parameters.items():
        if name in ('self', 'gridSize', 'visualize') or param.default is inspect.Parameter.empty:
            continue
        params[name] = param.default
    return clip_gaussian_params(params)


def candidate_dots(params):
    return [(label, params.get(wkey, 0.0), params.get(skey, 0.0), colour)
            for label, wkey, skey, colour in GAUSSIAN_DOTS]
