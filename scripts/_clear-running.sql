UPDATE execution_entity SET status='crashed', stoppedAt=datetime('now') WHERE status IN ('running','new','waiting');
