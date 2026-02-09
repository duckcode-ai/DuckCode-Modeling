# Real Scenario YAML Imports

These files are designed for UI import and gate testing with complex, enterprise-like schemas.

## File Pairs
1. `retail-analytics-baseline.model.yaml`
2. `retail-analytics-change.model.yaml`
3. `fintech-risk-baseline.model.yaml`
4. `fintech-risk-change.model.yaml`

## Suggested Gate Tests
1. `./dm gate model-examples/real-scenarios/retail-analytics-baseline.model.yaml model-examples/real-scenarios/retail-analytics-change.model.yaml`
2. `./dm gate model-examples/real-scenarios/fintech-risk-baseline.model.yaml model-examples/real-scenarios/fintech-risk-change.model.yaml`

## Expected Outcomes (without `--allow-breaking`)
1. Retail pair should fail gate because of breaking changes:
   - `SalesOrder.total_amount` type changed
   - `PaymentTransaction.gateway_reference` removed
   - `Shipment.delivered_at` changed from nullable to non-nullable
2. Fintech pair should fail gate because of breaking changes:
   - `MoneyTransfer.transfer_amount` type changed
   - `LedgerEntry.source_system` removed
   - `CardTransaction.settlement_currency` changed from nullable to non-nullable
