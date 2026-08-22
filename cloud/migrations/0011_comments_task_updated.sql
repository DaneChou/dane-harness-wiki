CREATE INDEX comments_task_updated
  ON comments(task_id, updated_at, id);
