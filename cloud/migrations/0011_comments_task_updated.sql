ALTER TABLE comments
  ADD COLUMN change_revision INTEGER NOT NULL DEFAULT 0;

ALTER TABLE attachments
  ADD COLUMN change_revision INTEGER NOT NULL DEFAULT 0;

CREATE INDEX comments_task_change_revision
  ON comments(task_id, change_revision);

CREATE INDEX attachments_task_change_revision
  ON attachments(task_id, comment_id, change_revision);

CREATE INDEX attachments_comment_change_revision
  ON attachments(comment_id, change_revision);
