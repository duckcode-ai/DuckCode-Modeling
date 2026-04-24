import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import request from "supertest";
import { getApp, createProject } from "./helpers/harness.js";

describe("AI proposals", () => {
  let app;
  let project;

  before(async () => {
    app = await getApp();
    project = createProject({
      modelsDir: "DataLex",
      seed: {
        "crm/Conceptual/customer.diagram.yaml": `kind: diagram
name: customer
title: Customer
layer: conceptual
domain: crm
entities:
  - entity: Customer
    x: 100
    y: 120
relationships: []
`,
        "crm/Conceptual/customer.model.yaml": `model:
  name: customer
  kind: conceptual
  domain: crm
entities:
  - name: Customer
    type: concept
    description: Customer business concept
`,
      },
    });
    mkdirSync(join(project.modelPath, "Skills"), { recursive: true });
    writeFileSync(join(project.modelPath, "Skills", "naming-standards.md"), [
      "---",
      "name: \"Naming Standards\"",
      "description: \"Business naming and owner metadata standards.\"",
      "use_when:",
      "  - \"business names\"",
      "  - \"owner metadata\"",
      "tags:",
      "  - \"naming\"",
      "  - \"owner\"",
      "layers:",
      "  - \"conceptual\"",
      "agent_modes:",
      "  - \"conceptual_architect\"",
      "priority: 5",
      "---",
      "",
      "# Naming Standards",
      "Use clear business names and owner metadata.",
      "",
    ].join("\n"), "utf-8");
  });

  after(() => project.cleanup());

  test("rebuilds local AI index and searches without a provider", async () => {
    const rebuild = await request(app)
      .post("/api/ai/index/rebuild")
      .send({ projectId: project.id });
    assert.equal(rebuild.status, 200);
    assert.equal(rebuild.body.ok, true);
    assert.ok(rebuild.body.recordCount >= 3);

    const ask = await request(app)
      .post("/api/ai/ask")
      .send({
        projectId: project.id,
        message: "What do we know about Customer?",
        context: { kind: "entity", entityName: "Customer" },
        provider: { provider: "local" },
      });
    assert.equal(ask.status, 200);
    assert.equal(ask.body.ok, true);
    assert.ok(ask.body.sources.some((source) => /Customer|customer/.test(source.name || source.path)));
    assert.ok(ask.body.agent_run.agents.some((agent) => agent.id === "conceptual_architect" || agent.id === "governance_reviewer"));
    assert.deepEqual(ask.body.proposed_changes, []);
    assert.ok(ask.body.chatId);
  });

  test("indexes dbt SQL, YAML, manifest, and catalog facts for reverse engineering", async () => {
    mkdirSync(join(project.path, "models", "marts"), { recursive: true });
    mkdirSync(join(project.path, "target"), { recursive: true });
    writeFileSync(join(project.path, "models", "marts", "fct_orders.sql"), "select order_id, customer_id from {{ ref('stg_orders') }}\n", "utf-8");
    writeFileSync(join(project.path, "models", "marts", "schema.yml"), [
      "version: 2",
      "models:",
      "  - name: fct_orders",
      "    description: Fact table for customer orders.",
      "    columns:",
      "      - name: order_id",
      "        description: Order identifier.",
      "",
    ].join("\n"), "utf-8");
    writeFileSync(join(project.path, "target", "manifest.json"), JSON.stringify({
      metadata: { project_name: "jaffle_shop" },
      nodes: {
        "model.jaffle_shop.fct_orders": {
          unique_id: "model.jaffle_shop.fct_orders",
          resource_type: "model",
          name: "fct_orders",
          original_file_path: "models/marts/fct_orders.sql",
          fqn: ["jaffle_shop", "marts", "fct_orders"],
          description: "Fact table for customer orders.",
          depends_on: { nodes: ["model.jaffle_shop.stg_orders"] },
          columns: {
            order_id: { name: "order_id", description: "Order identifier", data_type: "integer" },
          },
          config: { materialized: "table" },
        },
      },
      sources: {},
      metrics: {},
      semantic_models: {},
    }, null, 2), "utf-8");
    writeFileSync(join(project.path, "target", "catalog.json"), JSON.stringify({
      metadata: { project_name: "jaffle_shop" },
      nodes: {
        "model.jaffle_shop.fct_orders": {
          metadata: { name: "fct_orders", type: "BASE TABLE", schema: "marts" },
          columns: {
            order_id: { name: "order_id", type: "INTEGER", index: 1, comment: "Order identifier" },
          },
        },
      },
      sources: {},
    }, null, 2), "utf-8");

    const rebuild = await request(app)
      .post("/api/ai/index/rebuild")
      .send({ projectId: project.id });
    assert.equal(rebuild.status, 200);
    assert.equal(rebuild.body.ok, true);
    assert.ok(rebuild.body.typedCounts.dbt_sql >= 1);
    assert.ok(rebuild.body.typedCounts.dbt_manifest_model >= 1);
    assert.ok(rebuild.body.typedCounts.dbt_catalog_column >= 1);
    assert.equal(rebuild.body.dbtArtifacts.manifest, true);
    assert.equal(rebuild.body.dbtArtifacts.catalog, true);
    assert.ok(existsSync(join(project.path, ".datalex", "agent", "index.json")));

    const ask = await request(app)
      .post("/api/ai/ask")
      .send({
        projectId: project.id,
        message: "Reverse engineer fct_orders and order_id",
        provider: { provider: "local" },
      });
    assert.equal(ask.status, 200);
    assert.ok(ask.body.sources.some((source) => /fct_orders|order_id/.test(`${source.name} ${source.path}`)));

    const repoScoped = await request(app)
      .post("/api/ai/context/preview")
      .send({
        projectId: project.id,
        message: "Reverse engineer this repo into a business conceptual model",
        context: {
          kind: "diagram",
          filePath: "crm/Conceptual/customer.diagram.yaml",
          activeFilePath: "crm/Conceptual/customer.diagram.yaml",
        },
      });
    assert.equal(repoScoped.status, 200);
    assert.equal(repoScoped.body.ok, true);
    assert.equal(repoScoped.body.retrieval_pipeline[0], "repo_wide_context");
    assert.ok(repoScoped.body.sources.some((source) => source.kind === "dbt_sql" && source.path === "models/marts/fct_orders.sql"));
    assert.ok(repoScoped.body.sources.some((source) => source.kind === "dbt_manifest_model" && source.name === "fct_orders"));

    const exactColumn = await request(app)
      .post("/api/ai/context/preview")
      .send({
        projectId: project.id,
        message: "What is the datatype and test context for fct_orders.order_id?",
        context: { kind: "workspace" },
      });
    assert.equal(exactColumn.status, 200);
    assert.equal(exactColumn.body.ok, true);
    assert.ok(["dbt_catalog_column", "dbt_manifest_column"].includes(exactColumn.body.sources[0]?.kind));
    assert.ok(exactColumn.body.sources.some((source) => source.name === "fct_orders.order_id"));
    assert.ok(exactColumn.body.sources.every((source) => String(source.description || "").length <= 260));
  });

  test("previews routed AI context with relevant skills", async () => {
    const res = await request(app)
      .post("/api/ai/context/preview")
      .send({
        projectId: project.id,
        message: "Create a conceptual customer model with business names and owner metadata",
        context: { kind: "workspace", modelKind: "conceptual" },
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.agents.some((agent) => agent.id === "conceptual_architect"));
    assert.ok(res.body.selected_skills.some((skill) => skill.path === "Skills/naming-standards.md"));
    assert.ok(res.body.retrieval_pipeline.includes("scoped_skills"));
  });

  test("skill controls can disable auto-selected skills", async () => {
    const res = await request(app)
      .post("/api/ai/context/preview")
      .send({
        projectId: project.id,
        message: "Create a conceptual customer model with owner metadata",
        context: { modelKind: "conceptual" },
        skills: { disabled: ["Skills/naming-standards.md"] },
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.selected_skills.some((skill) => skill.path === "Skills/naming-standards.md"), false);
  });

  test("persists AI chats and extracts modeling memory", async () => {
    const ask = await request(app)
      .post("/api/ai/ask")
      .send({
        projectId: project.id,
        message: "Always use crm as the bounded context for customer concepts.",
        provider: { provider: "local" },
      });
    assert.equal(ask.status, 200);
    assert.equal(ask.body.ok, true);
    assert.ok(ask.body.chatId);
    assert.ok(ask.body.memory.added.some((item) => item.category === "user_preference"));

    const chats = await request(app)
      .get("/api/ai/chats")
      .query({ projectId: project.id });
    assert.equal(chats.status, 200);
    assert.ok(chats.body.chats.some((chat) => chat.id === ask.body.chatId && chat.messageCount >= 2));

    const chat = await request(app)
      .get(`/api/ai/chats/${ask.body.chatId}`)
      .query({ projectId: project.id });
    assert.equal(chat.status, 200);
    const assistantMessage = chat.body.chat.messages.find((message) => message.role === "assistant");
    assert.equal(assistantMessage.metadata.aiResult.chatId, ask.body.chatId);
    assert.equal(assistantMessage.metadata.aiResult.answer, ask.body.answer);
    assert.ok(Array.isArray(assistantMessage.metadata.aiResult.sources));
    assert.ok(assistantMessage.metadata.aiResult.agent_run);

    const memory = await request(app)
      .get("/api/ai/memory")
      .query({ projectId: project.id });
    assert.equal(memory.status, 200);
    assert.ok(memory.body.memories.some((item) => /bounded context/.test(item.content)));
  });

  test("exposes provider metadata", async () => {
    const res = await request(app).get("/api/ai/providers");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.providers.some((provider) => provider.id === "openai"));
    assert.ok(res.body.providers.some((provider) => provider.id === "ollama"));
  });

  test("applies create_diagram proposal under the DataLex workspace", async () => {
    const res = await request(app)
      .post("/api/ai/proposals/apply")
      .send({
        projectId: project.id,
        changes: [{
          type: "create_diagram",
          domain: "sales",
          layer: "conceptual",
          name: "opportunity_flow",
          entities: [
            { entity: "Account", x: 100, y: 100 },
            { entity: "Opportunity", x: 380, y: 100 },
          ],
          relationships: [{
            name: "account_has_opportunities",
            from: { entity: "Account" },
            to: { entity: "Opportunity" },
            cardinality: "one_to_many",
            verb: "can have",
          }],
        }],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.applied.length, 1);
    assert.equal(res.body.primaryFile.path, "sales/Conceptual/opportunity_flow.diagram.yaml");
    const filePath = join(project.modelPath, "sales", "Conceptual", "opportunity_flow.diagram.yaml");
    assert.ok(existsSync(filePath));
    assert.match(readFileSync(filePath, "utf-8"), /account_has_opportunities/);
  });

  test("validates AI proposal without writing files", async () => {
    const target = join(project.modelPath, "sales", "Conceptual", "dry_run.diagram.yaml");
    const res = await request(app)
      .post("/api/ai/proposals/validate")
      .send({
        projectId: project.id,
        changes: [{
          type: "create_diagram",
          domain: "sales",
          layer: "conceptual",
          name: "dry_run",
          entities: [{ entity: "Account", x: 100, y: 100 }],
          relationships: [],
        }],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.valid, true);
    assert.equal(existsSync(target), false);
  });

  test("normalizes AI proposal aliases before validation", async () => {
    const target = join(project.modelPath, "sales", "Conceptual", "alias_dry_run.diagram.yaml");
    const res = await request(app)
      .post("/api/ai/proposals/validate")
      .send({
        projectId: project.id,
        changes: [{
          action: "create",
          artifact_type: "diagram",
          domain: "sales",
          layer: "conceptual",
          name: "alias_dry_run",
          entities: [{ entity: "Account", x: 100, y: 100 }],
          relationships: [],
        }],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.valid, true);
    assert.equal(res.body.results[0].type, "create_file");
    assert.equal(res.body.results[0].path, "sales/Conceptual/alias_dry_run.diagram.yaml");
    assert.equal(existsSync(target), false);
  });

  test("proposal validation reports invalid YAML", async () => {
    const res = await request(app)
      .post("/api/ai/proposals/validate")
      .send({
        projectId: project.id,
        changes: [{
          type: "create_file",
          path: "crm/Logical/bad-preview.model.yaml",
          content: "foo: bar\n",
        }],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.valid, false);
    assert.equal(res.body.results[0].errors[0].code, "SCHEMA_SHAPE");
  });

  test("rejects invalid generated model YAML before writing", async () => {
    const target = join(project.modelPath, "crm", "Logical", "bad.model.yaml");
    const res = await request(app)
      .post("/api/ai/proposals/apply")
      .send({
        projectId: project.id,
        changes: [{
          type: "create_file",
          path: "crm/Logical/bad.model.yaml",
          content: "foo: bar\n",
        }],
      });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, "SCHEMA_SHAPE");
    assert.equal(existsSync(target), false);
  });

  test("blocks proposal paths outside the DataLex workspace", async () => {
    const res = await request(app)
      .post("/api/ai/proposals/apply")
      .send({
        projectId: project.id,
        changes: [{
          type: "create_file",
          path: "../outside.model.yaml",
          content: "model:\n  name: outside\nentities: []\n",
        }],
      });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "PATH_ESCAPE");
  });
});
