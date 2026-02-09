CREATE TABLE customer (
  customer_id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  status TEXT
);

CREATE TABLE sales_order (
  order_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customer(customer_id),
  total_amount DECIMAL(12,2) NOT NULL
);
