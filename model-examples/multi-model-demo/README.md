# Multi-Model Demo

This directory demonstrates DataLex's **multi-model cross-reference** capabilities — a key Phase 2 feature that enables real-world projects with 10-50+ model files to compose and reference entities across files.

## Structure

```
multi-model-demo/
├── customers.model.yaml   # Customer domain (3 entities, no imports)
├── orders.model.yaml      # Order domain (3 entities, imports customers)
├── products.model.yaml    # Product domain (4 entities, imports orders → customers)
└── README.md
```

## Import Graph

```
customers (standalone)
    ↑
orders (imports: customers → alias "cust", entities: Customer, Address)
    ↑
products (imports: orders → alias "ord", entities: OrderItem)
         (transitive: also resolves customers via orders)
```

## Cross-Model Relationships

| Relationship | From Model | To Model | Description |
|---|---|---|---|
| `customer_orders` | orders | customers | Order.customer_id → Customer.customer_id |
| `order_shipping_address` | orders | customers | Order.shipping_address_id → Address.address_id |
| `product_order_items` | products | orders | Product.product_id → OrderItem.product_id |

## CLI Commands

```bash
# Resolve a single model and its imports
./dm resolve model-examples/multi-model-demo/orders.model.yaml

# Resolve all models in the project
./dm resolve-project model-examples/multi-model-demo

# Diff two project directories
./dm diff-all model-examples/multi-model-demo model-examples/multi-model-demo

# JSON output for CI integration
./dm resolve model-examples/multi-model-demo/products.model.yaml --output-json
```

## Entity Counts (after resolution)

| Model | Local Entities | With Imports |
|---|---|---|
| customers | 3 | 3 |
| orders | 3 | 5 (+ Customer, Address) |
| products | 4 | 7 (+ OrderItem, Customer, Address) |
