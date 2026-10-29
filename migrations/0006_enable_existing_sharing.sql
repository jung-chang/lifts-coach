-- Owner-directed, one-time default change for existing accounts. D1 records this
-- migration so subsequent user opt-outs are not reset by session reads or deploys.
-- Individual workout visibility, publications and training data are unchanged.
UPDATE sharing_settings
SET summary_enabled = 1,
    auto_publish_workouts = 1,
    workout_sharing_enabled_at = CASE
      WHEN auto_publish_workouts = 1
        THEN COALESCE(workout_sharing_enabled_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    END,
    audience_acknowledged_at = COALESCE(audience_acknowledged_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    policy_revision = policy_revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE summary_enabled <> 1
   OR auto_publish_workouts <> 1
   OR workout_sharing_enabled_at IS NULL
   OR audience_acknowledged_at IS NULL;
