import csv
from datetime import datetime, timezone
from pathlib import Path

from .settings import GENOMES_CSV, RESULTS_CSV

PARAM_KEYS = (
    'prey_weight', 'prey_sigma',
    'pred_weight', 'pred_sigma',
    'self_weight', 'self_sigma',
    'sep_weight', 'sep_sigma',
    'cell',
)

GENOME_FIELDS = (
    'id', 'visible', 'name',
    *PARAM_KEYS,
    'n_matches', 'mean_score', 'last_score',
)

RESULT_FIELDS = (
    'match_id', 'ts', 'genome_id', 'slot',
    'living', 'prey_surviving', 'kills', 'score',
    'opponents', 'max_steps', 'swarmsize',
)


def _truthy(value):
    return str(value).strip().lower() in ('1', 'true', 'yes', 'y')


def _num(row, key, cast=float, default=0):
    raw = row.get(key, '')
    if raw is None or raw == '':
        return default
    return cast(raw)


class Catalog:
    """genomes.csv is the roster; results.csv is one row per swarm per match."""

    def __init__(self, genomes_path=GENOMES_CSV, results_path=RESULTS_CSV):
        self.genomes_path = Path(genomes_path)
        self.results_path = Path(results_path)
        self._ensure(self.genomes_path, GENOME_FIELDS)
        self._ensure(self.results_path, RESULT_FIELDS)

    def _ensure(self, path, fields):
        if path.exists():
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('w', newline='') as fh:
            csv.DictWriter(fh, fieldnames=fields).writeheader()

    def _read_genomes(self):
        with self.genomes_path.open(newline='') as fh:
            return list(csv.DictReader(fh))

    def _write_genomes(self, rows):
        with self.genomes_path.open('w', newline='') as fh:
            writer = csv.DictWriter(fh, fieldnames=GENOME_FIELDS)
            writer.writeheader()
            for row in rows:
                writer.writerow({key: row.get(key, '') for key in GENOME_FIELDS})

    def _next_id(self, rows, key='id'):
        ids = [_num(row, key, int, 0) for row in rows]
        return (max(ids) if ids else 0) + 1

    def _param_default(self, key):
        return 2 if key == 'cell' else 0.0

    def _kwargs_from_row(self, row):
        return {
            key: _num(row, key, int if key == 'cell' else float, self._param_default(key))
            for key in PARAM_KEYS
        }

    def _row_from_kwargs(self, gid, name, kwargs, visible=1, n_matches=0, mean_score=0.0, last_score=0.0):
        row = {
            'id': gid,
            'visible': int(bool(visible)),
            'name': name,
            'n_matches': n_matches,
            'mean_score': mean_score,
            'last_score': last_score,
        }
        row.update({key: kwargs.get(key, self._param_default(key)) for key in PARAM_KEYS})
        return row

    def _client_from_row(self, row, classes):
        name = row.get('name') or 'Gaussian'
        if name == 'Field':
            name = 'Gaussian'
        cls = classes.get(name)
        if cls is None:
            cls = next(iter(classes.values()))
        kwargs = self._kwargs_from_row(row) if name == 'Gaussian' else {}
        return {
            'id': _num(row, 'id', int, 0),
            'name': name,
            'cls': cls,
            'kwargs': kwargs,
            'n_matches': _num(row, 'n_matches', int, 0),
            'mean_score': _num(row, 'mean_score', float, 0.0),
            'last_score': _num(row, 'last_score', float, 0.0),
        }

    def visible_clients(self, classes):
        return [
            self._client_from_row(row, classes)
            for row in self._read_genomes()
            if _truthy(row.get('visible', '0'))
        ]

    def add_genome(self, name, kwargs, visible=1):
        rows = self._read_genomes()
        gid = self._next_id(rows)
        rows.append(self._row_from_kwargs(gid, name, kwargs or {}, visible=visible))
        self._write_genomes(rows)
        return gid

    def genome(self, gid):
        """Parameter dict for one genomes.csv row, looked up by id."""
        for row in self._read_genomes():
            if _num(row, 'id', int, 0) == int(gid):
                return self._kwargs_from_row(row)
        raise KeyError(gid)

    def update_genome(self, gid, name, kwargs):
        rows = self._read_genomes()
        found = False
        for row in rows:
            if _num(row, 'id', int, 0) == gid:
                row['name'] = name
                for key in PARAM_KEYS:
                    if key in kwargs:
                        row[key] = kwargs[key]
                found = True
                break
        if not found:
            return self.add_genome(name, kwargs)
        self._write_genomes(rows)
        return gid

    def show(self, gid):
        rows = self._read_genomes()
        for row in rows:
            if _num(row, 'id', int, 0) == int(gid):
                row['visible'] = 1
        self._write_genomes(rows)

    def hide(self, gid):
        rows = self._read_genomes()
        for row in rows:
            if _num(row, 'id', int, 0) == gid:
                row['visible'] = 0
        self._write_genomes(rows)

    def hide_visible(self):
        rows = self._read_genomes()
        for row in rows:
            if _truthy(row.get('visible', '0')):
                row['visible'] = 0
        self._write_genomes(rows)

    def record_match(self, roster, metric_rows, max_steps, swarmsize):
        ids = [client.get('id') for client in roster]
        with self.results_path.open(newline='') as fh:
            existing = list(csv.DictReader(fh))
        match_id = self._next_id(existing, 'match_id')
        ts = datetime.now(timezone.utc).isoformat(timespec='seconds')
        genomes = self._read_genomes()
        by_id = {_num(row, 'id', int, 0): row for row in genomes}

        with self.results_path.open('a', newline='') as fh:
            writer = csv.DictWriter(fh, fieldnames=RESULT_FIELDS)
            for row in metric_rows:
                slot = int(row.get('swarm', 0))
                gid = ids[slot] if 0 <= slot < len(ids) else None
                if not gid:
                    continue
                opponents = ','.join(
                    str(other) for i, other in enumerate(ids) if i != slot and other
                )
                writer.writerow({
                    'match_id': match_id,
                    'ts': ts,
                    'genome_id': gid,
                    'slot': slot,
                    'living': row['living'],
                    'prey_surviving': row['prey_surviving'],
                    'kills': row['kills'],
                    'score': row['score'],
                    'opponents': opponents,
                    'max_steps': max_steps,
                    'swarmsize': swarmsize,
                })
                genome = by_id.get(int(gid))
                if genome is None:
                    continue
                n = _num(genome, 'n_matches', int, 0)
                mean = _num(genome, 'mean_score', float, 0.0)
                score = float(row['score'])
                genome['n_matches'] = n + 1
                genome['mean_score'] = (mean * n + score) / (n + 1)
                genome['last_score'] = score

        self._write_genomes(genomes)
        return match_id
