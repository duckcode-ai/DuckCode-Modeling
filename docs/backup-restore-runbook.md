# Backup and Restore Runbook (Prototype)

## 1. What to Backup
1. Repository source (`*.model.yaml`, policies, docs, schemas, tests).
2. Generated artifacts if needed (`gate-report.json`, SQL/dbt outputs).
3. UI local workspace export files (if users export snapshots).

## 2. Backup Procedure
1. Push all branches/tags to remote Git provider.
2. Export release bundle:
   - `git archive --format=tar.gz -o release-backup.tar.gz HEAD`
3. Store artifact in managed object storage.

## 3. Restore Procedure
1. Clone repository at target commit/tag.
2. Install dependencies:
   - `python3 -m pip install -r requirements.txt`
   - `cd packages/web-app && npm install`
3. Validate integrity:
   - `python3 -m unittest -q tests/test_mvp.py tests/test_real_scenarios.py tests/test_integrations.py tests/test_performance.py`
   - `./dm validate-all`

## 4. Disaster Recovery Drill (Prototype)
Run monthly:
1. Restore from latest archive into clean directory.
2. Execute validation, policy, and generation commands.
3. Record restore duration and any missing assets.
