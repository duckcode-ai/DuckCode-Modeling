{{ config(materialized='table') }}

select
  order_id,
  customer_id,
  order_date,
  total_amount
from source_model
