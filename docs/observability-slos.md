# Observability and SLOs (Prototype)

## 1. Current Signals
1. Unit/integration/performance test outcomes in CI.
2. CLI exit codes for validation, policy, and gate commands.
3. UI build artifact health (`npm run build`).

## 2. Prototype SLO Targets
1. `dm validate` for medium model (<200 entities): under 3 seconds.
2. `dm gate` for medium model: under 5 seconds.
3. UI first render for medium model: under 2 seconds in local dev mode.

## 3. Recommended Metrics for Hosted Phase
1. command_latency_ms by command type
2. gate_fail_rate and policy_violation_rate
3. diagram_render_time_ms and node_count bucket
4. parse_error_rate and import_failure_rate

## 4. Alerting Starter Rules
1. CI failure streak >= 3 runs on `main`.
2. Performance test threshold regression.
3. Policy check failure rate spike > 20% week-over-week.
