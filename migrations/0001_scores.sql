-- The daily leaderboard: every run kept, as replayed by the Worker.
CREATE TABLE scores (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL,
  initials TEXT NOT NULL,
  sats INTEGER NOT NULL,
  depth INTEGER NOT NULL,
  level INTEGER NOT NULL,
  chain INTEGER NOT NULL,
  ticks INTEGER NOT NULL,
  -- The run's final state hash: the same run sent twice is one entry.
  hash INTEGER NOT NULL,
  -- The run's inputs, so it can be replayed again, or watched.
  inputs TEXT NOT NULL,
  UNIQUE (day, hash)
);

CREATE INDEX scores_board ON scores (day, sats DESC, id);
