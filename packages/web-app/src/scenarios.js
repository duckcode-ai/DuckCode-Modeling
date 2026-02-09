import { SAMPLE_MODEL } from "./sampleModel";

const NON_BREAKING_CURRENT = `model:
  name: commerce
  version: 1.1.0
  domain: sales
  owners:
    - data-platform@company.com
  state: draft

entities:
  - name: Customer
    type: table
    description: Customer master record
    tags: [PII, GOLD]
    fields:
      - name: customer_id
        type: integer
        primary_key: true
        nullable: false
      - name: email
        type: string
        nullable: false
        unique: true
      - name: lifecycle_stage
        type: string
        nullable: true

  - name: Order
    type: table
    fields:
      - name: order_id
        type: integer
        primary_key: true
        nullable: false
      - name: customer_id
        type: integer
        nullable: false
      - name: total_amount
        type: decimal(12,2)
        nullable: false

relationships:
  - name: customer_orders
    from: Customer.customer_id
    to: Order.customer_id
    cardinality: one_to_many
`;

const BREAKING_CURRENT = `model:
  name: commerce
  version: 2.0.0
  domain: sales
  owners:
    - data-platform@company.com
  state: draft

entities:
  - name: Customer
    type: table
    fields:
      - name: customer_id
        type: integer
        primary_key: true
        nullable: false
      - name: email
        type: string
        nullable: false

  - name: Order
    type: table
    fields:
      - name: order_id
        type: integer
        primary_key: true
        nullable: false
      - name: customer_id
        type: integer
        nullable: false
      - name: total_amount
        type: decimal(18,2)
        nullable: false

relationships:
  - name: customer_orders
    from: Customer.customer_id
    to: Order.customer_id
    cardinality: one_to_many
`;

const INVALID_CURRENT = `model:
  name: commerce
  version: 1.0.0
  domain: sales
  owners:
    - data-platform@company.com
  state: draft

entities:
  - name: Customer
    type: table
    fields:
      - name: customer_id
        type: integer
        nullable: false
      - name: emailAddress
        type: string
        nullable: false

relationships:
  - name: bad_ref
    from: Customer.customer_id
    to: Order.customer_id
    cardinality: one_to_many
`;

export const SCENARIOS = [
  {
    id: "non_breaking_additive",
    name: "Non-Breaking Additive Change",
    description: "Adds nullable field. Expected gate pass.",
    baseline: SAMPLE_MODEL,
    current: NON_BREAKING_CURRENT,
    expectedPass: true
  },
  {
    id: "breaking_type_change",
    name: "Breaking Type Change",
    description: "Changes Order.total_amount type. Expected gate fail.",
    baseline: SAMPLE_MODEL,
    current: BREAKING_CURRENT,
    expectedPass: false
  },
  {
    id: "invalid_model",
    name: "Invalid Model",
    description: "Invalid field naming and missing PK. Expected gate fail.",
    baseline: SAMPLE_MODEL,
    current: INVALID_CURRENT,
    expectedPass: false
  }
];
