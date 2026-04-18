CREATE TABLE "sales"."customer" (
  "id" BIGINT NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "display_name" VARCHAR(120),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT 'CURRENT_TIMESTAMP',
  "tags" TEXT[],
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idx_customer_email" ON "sales"."customer" ("email");

CREATE TABLE "sales"."order" (
  "id" BIGINT NOT NULL,
  "customer_id" BIGINT NOT NULL,
  "total_amount" NUMERIC(12,2) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  PRIMARY KEY ("id")
);

ALTER TABLE "sales"."order" ADD CONSTRAINT "fk_order_customer_id" FOREIGN KEY ("customer_id") REFERENCES "customer" ("id") ON DELETE CASCADE;
