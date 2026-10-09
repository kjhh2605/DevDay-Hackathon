CREATE TABLE speech_groups (
  id uuid PRIMARY KEY,
  study_id uuid NOT NULL REFERENCES studies(id),
  topic_id uuid NOT NULL REFERENCES topics(id),
  speaker_user_id uuid NOT NULL REFERENCES users(id),
  start_order integer NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX speech_groups_topic_order ON speech_groups(topic_id, start_order);
CREATE UNIQUE INDEX speech_groups_open_speaker ON speech_groups(topic_id, speaker_user_id)
  WHERE data->>'state' IN ('collecting','deciding') AND data->>'closeReason' IS NULL;
