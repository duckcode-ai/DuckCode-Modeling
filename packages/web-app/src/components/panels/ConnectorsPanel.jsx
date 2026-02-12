import React, { useState, useEffect, useCallback } from "react";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Plug,
  Eye,
  EyeOff,
  Download,
  ChevronRight,
  ChevronLeft,
  Table2,
  Layers,
  Check,
  Square,
  CheckSquare,
  KeyRound,
  Lock,
  History,
  FolderTree,
  Sparkles,
  ShieldCheck,
  FolderOpen,
  FileStack,
  FileText,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import ConnectorLogo from "../icons/ConnectorLogo";

const API = "http://localhost:3001";

const CONNECTOR_FIELDS = {
  dbt_repo: [
    { key: "repo_path", label: "dbt Repository Path", placeholder: "/Users/you/dbt-project", required: true },
  ],
  postgres: [
    { key: "host", label: "Host", placeholder: "localhost", required: true },
    { key: "port", label: "Port", placeholder: "5432", type: "number" },
    { key: "database", label: "Database", placeholder: "mydb", required: true },
    { key: "user", label: "User", placeholder: "postgres", required: true },
    { key: "password", label: "Password", placeholder: "••••••••", secret: true },
  ],
  mysql: [
    { key: "host", label: "Host", placeholder: "localhost", required: true },
    { key: "port", label: "Port", placeholder: "3306", type: "number" },
    { key: "database", label: "Database", placeholder: "mydb", required: true },
    { key: "user", label: "User", placeholder: "root", required: true },
    { key: "password", label: "Password", placeholder: "••••••••", secret: true },
  ],
  snowflake_password: [
    { key: "host", label: "Account", placeholder: "ORGID-ACCTNAME (without .snowflakecomputing.com)", required: true },
    { key: "user", label: "User", placeholder: "MY_USER", required: true },
    { key: "password", label: "Password", placeholder: "••••••••", secret: true },
    { key: "database", label: "Database", placeholder: "MY_DB", required: true },
    { key: "warehouse", label: "Warehouse", placeholder: "COMPUTE_WH" },
  ],
  snowflake_keypair: [
    { key: "host", label: "Account", placeholder: "ORGID-ACCTNAME (without .snowflakecomputing.com)", required: true },
    { key: "user", label: "User", placeholder: "MY_USER", required: true },
    { key: "private_key_content", label: "Private Key (PEM)", placeholder: "-----BEGIN ENCRYPTED PRIVATE KEY-----\n...\n-----END ENCRYPTED PRIVATE KEY-----", required: true, multiline: true },
    { key: "password", label: "Key Passphrase", placeholder: "optional — leave blank if unencrypted", secret: true },
    { key: "database", label: "Database", placeholder: "MY_DB", required: true },
    { key: "warehouse", label: "Warehouse", placeholder: "COMPUTE_WH" },
  ],
  bigquery: [
    { key: "project", label: "Project ID", placeholder: "my-gcp-project", required: true },
  ],
  databricks: [
    { key: "host", label: "Server Hostname", placeholder: "adb-xxx.azuredatabricks.net", required: true },
    { key: "port", label: "Port", placeholder: "443", type: "number" },
    { key: "token", label: "Access Token", placeholder: "dapi...", secret: true, required: true },
    { key: "catalog", label: "Catalog", placeholder: "main" },
  ],
};

const CONNECTOR_META = {
  dbt_repo: {
    name: "dbt Repo",
    tag: "Local YAML",
    color: "text-[#0f4c81]",
    bg: "bg-[#ebf4ff]",
    border: "border-[#c6dcff]",
    accent: "bg-[#1f6fd1]",
  },
  postgres: {
    name: "PostgreSQL",
    tag: "OLTP",
    color: "text-[#235b93]",
    bg: "bg-[#eef5fd]",
    border: "border-[#cde0f4]",
    accent: "bg-[#2767a7]",
  },
  mysql: {
    name: "MySQL",
    tag: "OLTP",
    color: "text-[#9a5a12]",
    bg: "bg-[#fff4e7]",
    border: "border-[#f8d9b2]",
    accent: "bg-[#c7781c]",
  },
  snowflake: {
    name: "Snowflake",
    tag: "Cloud DW",
    color: "text-[#0f89bd]",
    bg: "bg-[#e8f7ff]",
    border: "border-[#bfe8ff]",
    accent: "bg-[#10a7e6]",
  },
  bigquery: {
    name: "BigQuery",
    tag: "Analytics",
    color: "text-[#285bb7]",
    bg: "bg-[#eef4ff]",
    border: "border-[#d4e1ff]",
    accent: "bg-[#3e78ea]",
  },
  databricks: {
    name: "Databricks",
    tag: "Lakehouse",
    color: "text-[#b7342d]",
    bg: "bg-[#fff0ef]",
    border: "border-[#ffd3cf]",
    accent: "bg-[#ea4335]",
  },
};

const DB_STEPS = [
  { id: "connect", label: "Connect", icon: Plug },
  { id: "schemas", label: "Schemas", icon: Layers },
  { id: "tables", label: "Tables", icon: Table2 },
  { id: "pull", label: "Pull", icon: Download },
];

const DBT_STEPS = [
  { id: "repo", label: "Repo", icon: FolderOpen },
  { id: "scan", label: "Scan", icon: FileStack },
  { id: "convert", label: "Convert", icon: Download },
];

async function apiPost(path, body) {
  const resp = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `Request failed (${resp.status})`);
  return data;
}

async function apiGet(path) {
  const resp = await fetch(`${API}${path}`);
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `Request failed (${resp.status})`);
  return data;
}

async function apiPut(path, body) {
  const resp = await fetch(`${API}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `Request failed (${resp.status})`);
  return data;
}

function joinPath(base, child) {
  const b = String(base || "").replace(/[\\/]+$/, "");
  const c = String(child || "").replace(/^[\\/]+/, "");
  if (!b) return c;
  if (!c) return b;
  return `${b}/${c}`;
}

function normalizePath(path) {
  return String(path || "").replace(/[\\/]+$/, "");
}

function sanitizeModelStem(name, fallback = "dbt_model") {
  const stem = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!stem) return fallback;
  return /^[0-9]/.test(stem) ? `m_${stem}` : stem;
}

function deriveModelStemFromDbtPath(relPath, prefix = "") {
  const normalized = String(relPath || "schema.yml")
    .replace(/\\/g, "/")
    .replace(/\.ya?ml$/i, "")
    .replace(/^\/+|\/+$/g, "");
  const parts = normalized.split("/").filter(Boolean);
  const joined = parts.length > 0 ? parts.join("_") : "schema";
  const prefixed = prefix ? `${prefix}_${joined}` : joined;
  return sanitizeModelStem(prefixed, "dbt_model");
}

export default function ConnectorsPanel() {
  const [connectors, setConnectors] = useState(null);
  const [savedConnections, setSavedConnections] = useState([]);
  const [selectedConnector, setSelectedConnector] = useState(null);
  const [activeConnectionId, setActiveConnectionId] = useState(null);
  const [snowflakeAuth, setSnowflakeAuth] = useState("password"); // "password" | "keypair"
  const [step, setStep] = useState(0);
  const [formValues, setFormValues] = useState({});
  const [showSecrets, setShowSecrets] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Step 1: connection test
  const [connected, setConnected] = useState(false);

  // Step 2: schemas (multi-select)
  const [schemas, setSchemas] = useState([]);
  const [selectedSchemas, setSelectedSchemas] = useState(new Set());

  // Step 3: tables (per-schema preview before pull)
  const [previewSchema, setPreviewSchema] = useState(null);
  const [previewTables, setPreviewTables] = useState([]);
  const [schemaTableSelections, setSchemaTableSelections] = useState({});

  // Step 4: pull result
  const [pullResult, setPullResult] = useState(null);
  const [pullProgress, setPullProgress] = useState(null);
  const [targetProjectId, setTargetProjectId] = useState("");
  const [dbtScan, setDbtScan] = useState(null);
  const [dbtTargetMode, setDbtTargetMode] = useState("new_subfolder");
  const [dbtSubfolderName, setDbtSubfolderName] = useState("duckcodemodeling-models");
  const [dbtTargetPath, setDbtTargetPath] = useState("");
  const [dbtProjectName, setDbtProjectName] = useState("");
  const [dbtModelName, setDbtModelName] = useState("");
  const [dbtCreateTargetIfMissing, setDbtCreateTargetIfMissing] = useState(true);
  const [dbtAutoOpen, setDbtAutoOpen] = useState(true);
  const [dbtOverwrite, setDbtOverwrite] = useState(false);
  const [dbtResult, setDbtResult] = useState(null);

  const {
    loadImportedYaml,
    loadMultipleImportedYaml,
    activeProjectId,
    projects,
    openFile,
    loadProjects,
    selectProject,
  } = useWorkspaceStore();
  const { addToast, setBottomPanelTab } = useUiStore();

  const refreshSavedConnections = useCallback(async () => {
    try {
      const data = await apiGet("/api/connections");
      setSavedConnections(data.connections || []);
    } catch (_err) {
      setSavedConnections([]);
    }
  }, []);

  // Fetch connector list
  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`${API}/api/connectors`);
        if (resp.ok) setConnectors(await resp.json());
        else setConnectors(Object.keys(CONNECTOR_META).map((t) => ({ type: t, name: CONNECTOR_META[t].name, installed: false, status: "API server not running" })));
      } catch (_) {
        setConnectors(Object.keys(CONNECTOR_META).map((t) => ({ type: t, name: CONNECTOR_META[t].name, installed: false, status: "API server not running" })));
      }
      await refreshSavedConnections();
    })();
  }, [refreshSavedConnections]);

  const resetWizard = () => {
    setStep(0);
    setConnected(false);
    setTargetProjectId("");
    setSchemas([]);
    setSelectedSchemas(new Set());
    setPreviewSchema(null);
    setPreviewTables([]);
    setSchemaTableSelections({});
    setPullResult(null);
    setPullProgress(null);
    setDbtScan(null);
    setDbtTargetMode("new_subfolder");
    setDbtSubfolderName("duckcodemodeling-models");
    setDbtTargetPath("");
    setDbtProjectName("");
    setDbtModelName("");
    setDbtCreateTargetIfMissing(true);
    setDbtAutoOpen(true);
    setDbtOverwrite(false);
    setDbtResult(null);
    setError(null);
  };

  const selectConnector = (type) => {
    setSelectedConnector(type);
    setActiveConnectionId(null);
    setTargetProjectId("");
    setFormValues({});
    setShowSecrets({});
    setSnowflakeAuth("password");
    resetWizard();
  };

  const backToConnectionChooser = () => {
    setSelectedConnector(null);
    setActiveConnectionId(null);
    setFormValues({});
    setShowSecrets({});
    setSnowflakeAuth("password");
    resetWizard();
  };

  const loadSavedConnection = (connection) => {
    const details = connection?.details || {};
    const secrets = connection?.secrets || {};
    const restored = {};
    [details, secrets].forEach((chunk) => {
      Object.entries(chunk).forEach(([k, v]) => {
        if (k === "auth") return;
        if (v === "__redacted__") return;
        restored[k] = String(v);
      });
    });

    setSelectedConnector(connection.connector);
    setActiveConnectionId(connection.id);
    setTargetProjectId("");
    setSnowflakeAuth(details.auth === "keypair" ? "keypair" : "password");
    setFormValues(restored);
    setShowSecrets({});
    resetWizard();
  };

  const handleFieldChange = (key, value) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    if (connected) { setConnected(false); setStep(0); }
    setError(null);
  };

  // Step 1: Test connection
  const handleTestConnection = async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await apiPost("/api/connectors/test", {
        connector: selectedConnector,
        connection_id: activeConnectionId,
        ...formValues,
      });
      if (data.ok) {
        if (data.connectionId) setActiveConnectionId(data.connectionId);
        await refreshSavedConnections();
        setConnected(true);
        // Auto-advance: fetch schemas
        setStep(1);
        await fetchSchemas();
      } else {
        setError(data.message || "Connection failed");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Fetch schemas
  const fetchSchemas = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiPost("/api/connectors/schemas", { connector: selectedConnector, ...formValues });
      setSchemas(data);
      // Auto-select all schemas by default
      setSelectedSchemas(new Set(data.map((s) => s.name)));
    } catch (err) {
      setError(err.message);
      setSchemas([]);
    } finally {
      setLoading(false);
    }
  };

  // Schema multi-select helpers
  const toggleSchema = (name) => {
    setSelectedSchemas((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAllSchemas = () => {
    if (selectedSchemas.size === schemas.length) setSelectedSchemas(new Set());
    else setSelectedSchemas(new Set(schemas.map((s) => s.name)));
  };

  // Step 3: Preview tables for a specific schema (optional drill-in)
  const fetchTablesPreview = async (schemaName) => {
    setLoading(true);
    setError(null);
    setPreviewSchema(schemaName);
    try {
      const params = { connector: selectedConnector, ...formValues, db_schema: schemaName };
      if (selectedConnector === "bigquery") params.dataset = schemaName;
      const data = await apiPost("/api/connectors/tables", params);
      setPreviewTables(data);
      // Initialize table selection for this schema (all selected by default)
      setSchemaTableSelections((prev) => ({
        ...prev,
        [schemaName]: prev[schemaName] || new Set(data.map((t) => t.name)),
      }));
    } catch (err) {
      setError(err.message);
      setPreviewTables([]);
    } finally {
      setLoading(false);
    }
  };

  const togglePreviewTable = (name) => {
    if (!previewSchema) return;
    setSchemaTableSelections((prev) => {
      const current = new Set(prev[previewSchema] || []);
      if (current.has(name)) current.delete(name);
      else current.add(name);
      return { ...prev, [previewSchema]: current };
    });
  };

  const toggleAllPreviewTables = () => {
    if (!previewSchema) return;
    const current = schemaTableSelections[previewSchema] || new Set();
    if (current.size === previewTables.length) {
      setSchemaTableSelections((prev) => ({ ...prev, [previewSchema]: new Set() }));
    } else {
      setSchemaTableSelections((prev) => ({ ...prev, [previewSchema]: new Set(previewTables.map((t) => t.name)) }));
    }
  };

  // Step 4: Pull — multi-schema mode
  const handlePull = async () => {
    const schemasToProcess = [...selectedSchemas];
    if (schemasToProcess.length === 0) return;
    const targetProject = (projects || []).find((p) => p.id === targetProjectId);
    const targetPath = targetProject?.path || "";
    if (!targetProjectId || !targetPath) {
      setError("Select a target project folder before pulling metadata.");
      return;
    }

    setLoading(true);
    setError(null);
    setPullResult(null);
    setPullProgress({ current: 0, total: schemasToProcess.length, currentSchema: schemasToProcess[0] });

    try {
      if (targetProjectId !== activeProjectId) {
        await selectProject(targetProjectId);
      }
      if (schemasToProcess.length === 1) {
        // Single schema — use original endpoint for backward compat
        const schemaName = schemasToProcess[0];
        const tableSet = schemaTableSelections[schemaName];
        const params = {
          connector: selectedConnector,
          connection_id: activeConnectionId,
          project_id: targetProjectId,
          project_path: targetPath,
          ...formValues,
          db_schema: schemaName,
          model_name: schemaName,
          tables: tableSet ? [...tableSet].join(",") : "",
        };
        if (selectedConnector === "bigquery") params.dataset = schemaName;
        const data = await apiPost("/api/connectors/pull", params);
        if (data.connectionId) setActiveConnectionId(data.connectionId);
        if (data.success && data.yaml) {
          await loadImportedYaml(schemaName, data.yaml);
          setPullResult({
            schemasProcessed: 1,
            schemasFailed: 0,
            totalEntities: data.entityCount || 0,
            totalFields: data.fieldCount || 0,
            totalRelationships: data.relationshipCount || 0,
            results: [{ schema: schemaName, success: true, ...data }],
            errors: [],
          });
          addToast?.({ message: `Pulled ${data.entityCount || 0} tables from ${CONNECTOR_META[selectedConnector]?.name} / ${schemaName}`, type: "success" });
        } else {
          setError(data.error || "Pull failed");
        }
      } else {
        // Multi-schema — use pull-multi endpoint
        const schemaEntries = schemasToProcess.map((name) => {
          const tableSet = schemaTableSelections[name];
          return tableSet && tableSet.size > 0 ? { name, tables: [...tableSet] } : name;
        });
        const data = await apiPost("/api/connectors/pull-multi", {
          connector: selectedConnector,
          connection_id: activeConnectionId,
          project_id: targetProjectId,
          project_path: targetPath,
          ...formValues,
          schemas: schemaEntries,
        });
        if (data.connectionId) setActiveConnectionId(data.connectionId);

        // Load each successful schema as a separate model file
        const files = (data.results || []).filter((r) => r.success && r.yaml).map((r) => ({
          name: r.schema,
          yaml: r.yaml,
        }));
        if (files.length > 0) {
          await loadMultipleImportedYaml(files);
          addToast?.({ message: `Pulled ${files.length} schemas (${data.totalEntities} tables) as separate model files`, type: "success" });
        }
        setPullResult(data);
        if (data.errors?.length > 0 && files.length === 0) {
          setError(`All ${data.errors.length} schema pulls failed`);
        }
      }
      await refreshSavedConnections();
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setPullProgress(null);
    }
  };

  const handleDbtScan = async () => {
    const repoPath = String(formValues.repo_path || "").trim();
    if (!repoPath) {
      setError("dbt repository path is required.");
      return;
    }
    setLoading(true);
    setError(null);
    setDbtResult(null);
    try {
      const data = await apiPost("/api/connectors/dbt-repo/scan", { repo_path: repoPath });
      setDbtScan(data);
      if (data.suggestedSubfolder) setDbtSubfolderName(data.suggestedSubfolder);
      if (data.suggestedTargetPath) setDbtTargetPath(data.suggestedTargetPath);
      if (!dbtProjectName && data.suggestedProjectName) setDbtProjectName(data.suggestedProjectName);
      if (!dbtModelName && data.suggestedModelName) setDbtModelName(data.suggestedModelName);
      setStep(1);
      if ((data.dbtFileCount || 0) === 0) {
        setError("No dbt schema/source/semantic/metrics YAML files were found at this path.");
      }
    } catch (err) {
      setError(err.message);
      setDbtScan(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDbtConvert = async () => {
    if (!dbtScan || !Array.isArray(dbtScan.dbtFiles) || dbtScan.dbtFiles.length === 0) {
      setError("Scan a dbt repo with valid dbt YAML files before converting.");
      return;
    }

    const repoPath = String(formValues.repo_path || "").trim();
    const targetPath = dbtTargetMode === "new_subfolder"
      ? joinPath(repoPath, dbtSubfolderName || "duckcodemodeling-models")
      : String(dbtTargetPath || "").trim();
    const modelPrefix = sanitizeModelStem(dbtModelName || "", "");
    const projectName = String(dbtProjectName || dbtScan.suggestedProjectName || `${dbtScan.repoName || "dbt"}-duckcodemodeling`).trim();

    if (!targetPath) {
      setError("Target DuckCodeModeling folder path is required.");
      return;
    }
    if (!projectName) {
      setError("Project name is required.");
      return;
    }

    setLoading(true);
    setError(null);
    setDbtResult(null);

    try {
      let targetProject = (projects || []).find(
        (p) => normalizePath(p.path) === normalizePath(targetPath)
      );
      if (!targetProject) {
        const created = await apiPost("/api/projects", {
          name: projectName,
          path: targetPath,
          create_if_missing: dbtCreateTargetIfMissing,
        });
        targetProject = created.project;
      }
      if (!targetProject?.id) {
        throw new Error("Could not resolve target project.");
      }

      const currentFiles = await apiGet(`/api/projects/${targetProject.id}/files`);
      const existingNames = new Set((currentFiles.files || []).map((f) => f.name));
      const reservedNames = new Set();
      const generatedFiles = [];
      const failedFiles = [];
      let totalEntities = 0;
      let totalFields = 0;
      let totalRelationships = 0;

      for (const source of dbtScan.dbtFiles) {
        try {
          const payload = await apiGet(`/api/files?path=${encodeURIComponent(source.fullPath)}`);
          const baseStem = deriveModelStemFromDbtPath(source.path, modelPrefix);
          let candidateName = `${baseStem}.model.yaml`;
          let suffix = 1;
          while (reservedNames.has(candidateName) || (!dbtOverwrite && existingNames.has(candidateName))) {
            candidateName = `${baseStem}_${suffix}.model.yaml`;
            suffix += 1;
          }
          reservedNames.add(candidateName);

          const imported = await apiPost("/api/import", {
            format: "dbt",
            content: payload.content,
            filename: source.name || source.path,
            modelName: baseStem,
          });
          if (!imported?.yaml) {
            throw new Error("dbt import returned no YAML output");
          }

          const outputPath = joinPath(targetProject.path, candidateName);
          if (existingNames.has(candidateName) && dbtOverwrite) {
            await apiPut("/api/files", { path: outputPath, content: imported.yaml });
          } else {
            await apiPost(`/api/projects/${targetProject.id}/files`, {
              name: candidateName,
              content: imported.yaml,
            });
          }
          existingNames.add(candidateName);

          generatedFiles.push({
            sourcePath: source.path,
            fileName: candidateName,
            filePath: outputPath,
            entityCount: imported.entityCount || 0,
            fieldCount: imported.fieldCount || 0,
            relationshipCount: imported.relationshipCount || 0,
          });
          totalEntities += imported.entityCount || 0;
          totalFields += imported.fieldCount || 0;
          totalRelationships += imported.relationshipCount || 0;
        } catch (fileErr) {
          failedFiles.push({
            sourcePath: source.path,
            error: String(fileErr.message || fileErr),
          });
        }
      }

      if (generatedFiles.length === 0) {
        const firstErr = failedFiles[0]?.error || "No dbt files were converted.";
        throw new Error(firstErr);
      }

      await loadProjects();
      if (dbtAutoOpen) {
        await selectProject(targetProject.id);
        const refreshed = await apiGet(`/api/projects/${targetProject.id}/files`);
        const firstGeneratedName = generatedFiles[0]?.fileName;
        const modelFile = (refreshed.files || []).find((f) => f.name === firstGeneratedName);
        if (modelFile) {
          await openFile(modelFile);
        }
        setBottomPanelTab("properties");
      }

      setDbtResult({
        success: failedFiles.length === 0,
        project: targetProject,
        generatedFiles,
        failedFiles,
        generatedCount: generatedFiles.length,
        failedCount: failedFiles.length,
        dbtFileCount: dbtScan.dbtFileCount,
        totals: dbtScan.totals || {},
        entityCount: totalEntities,
        fieldCount: totalFields,
        relationshipCount: totalRelationships,
      });
      setStep(2);
      addToast?.({
        type: "success",
        message: `Converted ${generatedFiles.length} of ${dbtScan.dbtFileCount} dbt file${dbtScan.dbtFileCount === 1 ? "" : "s"} into DuckCodeModeling models`,
      });
      if (failedFiles.length > 0) {
        setError(`${failedFiles.length} dbt file${failedFiles.length === 1 ? "" : "s"} could not be converted. Review the result list.`);
      }
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  };

  const fieldKey = selectedConnector === "snowflake"
    ? (snowflakeAuth === "keypair" ? "snowflake_keypair" : "snowflake_password")
    : selectedConnector;
  const connectorSteps = selectedConnector === "dbt_repo" ? DBT_STEPS : DB_STEPS;
  const fields = fieldKey ? (CONNECTOR_FIELDS[fieldKey] || []) : [];
  const meta = selectedConnector ? CONNECTOR_META[selectedConnector] : null;
  const selectedTargetProject = (projects || []).find((p) => p.id === targetProjectId) || null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Step indicator bar */}
      {selectedConnector && meta && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border-primary/80 bg-gradient-to-r from-white to-slate-50/80 shrink-0">
          <ConnectorLogo type={selectedConnector} size={22} />
          <div className="min-w-0">
            <div className={`text-[11px] font-semibold ${meta.color}`}>{meta.name}</div>
            <div className="text-[9px] text-text-muted uppercase tracking-wider">{meta.tag}</div>
          </div>
          <div className="flex items-center gap-0.5 ml-3">
            {connectorSteps.map((s, i) => {
              const StepIcon = s.icon;
              const isActive = i === step;
              const isDone = i < step;
              return (
                <div key={s.id} className="flex items-center gap-0.5">
                  {i > 0 && <div className={`w-5 h-px ${isDone ? "bg-green-400" : "bg-border-primary"}`} />}
                  <div
                    className={`flex items-center gap-0.5 px-2.5 py-1 rounded-full text-[10px] font-semibold ${
                      isActive ? `${meta.bg} ${meta.color} ${meta.border} border shadow-sm` :
                      isDone ? "bg-green-50 text-green-600 border border-green-200" :
                      "text-text-muted bg-white border border-border-primary/70"
                    }`}
                  >
                    {isDone ? <Check size={9} /> : <StepIcon size={9} />}
                    {s.label}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            onClick={backToConnectionChooser}
            className="ml-auto px-2 py-1 rounded-md border border-border-primary bg-bg-primary text-[10px] font-medium text-text-secondary hover:bg-bg-hover"
          >
            Change Connector
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5 bg-[radial-gradient(circle_at_top_right,#dbeafe_0%,transparent_42%),radial-gradient(circle_at_top_left,#cffafe_0%,transparent_36%),linear-gradient(180deg,#f8fafc_0%,#ffffff_45%)]">
        <div className="max-w-5xl mx-auto space-y-4">
        <div className="rounded-2xl border border-white/70 bg-white/80 backdrop-blur-sm shadow-[0_10px_30px_rgba(15,23,42,0.08)] p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-slate-900 text-white shadow-sm">
              <Sparkles size={14} />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">Enterprise Connector Workspace</h2>
              <p className="text-[11px] text-slate-600 mt-1">
                Connect warehouse metadata, review schemas, and generate production-ready DuckCodeModeling models with one guided flow.
              </p>
              <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck size={11} />
                  Profile-aware credentials
                </span>
                <span className="inline-flex items-center gap-1">
                  <FolderTree size={11} />
                  Schema-to-model file mapping
                </span>
              </div>
            </div>
          </div>
        </div>
        {/* Saved connector profiles */}
        {savedConnections.length > 0 && (
          <div className="rounded-xl border border-border-primary/80 bg-white/90 backdrop-blur-sm shadow-[0_8px_20px_rgba(15,23,42,0.06)] p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <History size={11} />
                Saved Connections
              </div>
              <button
                onClick={refreshSavedConnections}
                className="text-[10px] text-text-muted hover:text-text-primary inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border-primary bg-bg-primary hover:bg-bg-hover"
              >
                <RefreshCw size={10} /> Refresh
              </button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 max-h-52 overflow-y-auto pr-0.5">
              {savedConnections.slice(0, 12).map((conn) => {
                const imports = Array.isArray(conn.imports) ? conn.imports : [];
                return (
                  <div
                    key={conn.id}
                    className={`rounded-lg border p-2.5 ${
                      activeConnectionId === conn.id
                        ? "border-blue-200 bg-blue-50/60 shadow-sm"
                        : "border-border-primary bg-bg-secondary/40"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <ConnectorLogo type={conn.connector} size={20} />
                      <span className="text-[11px] font-semibold text-text-primary truncate flex-1">{conn.name}</span>
                      <span className="text-[9px] uppercase tracking-wider text-text-muted">{conn.connector}</span>
                      <button
                        onClick={() => loadSavedConnection(conn)}
                        className="px-2.5 py-1 rounded-md border border-border-primary bg-bg-primary text-[10px] font-medium text-text-secondary hover:bg-bg-hover"
                      >
                        Load
                      </button>
                    </div>
                    <div className="text-[10px] text-text-muted mt-0.5 flex items-center gap-2">
                      {conn.details?.host && <span>{conn.details.host}</span>}
                      {conn.details?.database && <span>DB: {conn.details.database}</span>}
                      {conn.details?.project && <span>Project: {conn.details.project}</span>}
                    </div>
                    {imports.length > 0 && (
                      <div className="mt-1.5 pl-2 border-l border-border-primary/70 space-y-0.5">
                        {imports.slice(0, 3).map((imp) => (
                          <div key={imp.id} className="text-[10px] text-text-secondary flex items-center gap-1.5">
                            <FolderTree size={10} className="text-text-muted shrink-0" />
                            <span className="truncate flex-1">
                              {(imp.files || []).slice(0, 2).join(", ")}
                              {(imp.files || []).length > 2 ? ` +${imp.files.length - 2}` : ""}
                            </span>
                            <span className="text-[9px] text-text-muted shrink-0">
                              {(imp.schemas || []).length} schema
                              {(imp.schemas || []).length === 1 ? "" : "s"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Connector selector */}
        <div className="rounded-xl border border-border-primary/80 bg-white/90 backdrop-blur-sm shadow-[0_8px_20px_rgba(15,23,42,0.06)] p-3.5">
          <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-2.5">Select Connector</div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5">
            {Object.entries(CONNECTOR_META).map(([type, cm]) => {
              const isSelected = selectedConnector === type;
              const connInfo = connectors?.find((c) => c.type === type);
              const isInstalled = connInfo?.installed;
              return (
                <button key={type} onClick={() => selectConnector(type)}
                  className={`flex flex-col items-start gap-1.5 px-3 py-2.5 rounded-lg border text-left transition-all text-[10px] ${
                    isSelected
                      ? `${cm.border} ${cm.bg} ${cm.color} shadow-sm`
                      : "border-border-primary bg-bg-primary text-text-secondary hover:bg-bg-hover hover:shadow-sm"
                  }`}>
                  <div className="flex items-center w-full gap-2">
                    <ConnectorLogo type={type} size={22} />
                    <div className="min-w-0">
                      <div className="font-semibold leading-tight text-[11px]">{cm.name}</div>
                      <div className="text-[9px] uppercase tracking-wider opacity-75">{cm.tag}</div>
                    </div>
                  </div>
                  {connInfo && (
                    <div className={`text-[9px] font-medium ${isInstalled ? "text-green-600" : "text-amber-600"}`}>
                      {isInstalled ? "ready" : "no driver"}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 0: Connection form */}
        {selectedConnector && selectedConnector !== "dbt_repo" && step === 0 && (
          <div className={`rounded-xl border ${meta.border} ${meta.bg} p-3.5 space-y-2.5 shadow-[0_8px_20px_rgba(15,23,42,0.05)]`}>
            <div className={`text-xs font-semibold ${meta.color} flex items-center gap-1.5`}>
              <ConnectorLogo type={selectedConnector} size={20} />
              <span>{meta.name} Connection</span>
            </div>
            {selectedConnector === "snowflake" && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-text-muted font-medium mr-1">Auth:</span>
                <button
                  onClick={() => { setSnowflakeAuth("password"); setFormValues((p) => { const v = { ...p }; delete v.private_key_content; return v; }); setError(null); setConnected(false); setStep(0); }}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium border transition-colors ${
                    snowflakeAuth === "password"
                      ? "border-cyan-300 bg-white text-cyan-700"
                      : "border-border-primary bg-bg-primary text-text-muted hover:bg-bg-hover"
                  }`}
                >
                  <Lock size={10} /> Password
                </button>
                <button
                  onClick={() => { setSnowflakeAuth("keypair"); setFormValues((p) => { const v = { ...p }; delete v.password; return v; }); setError(null); setConnected(false); setStep(0); }}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium border transition-colors ${
                    snowflakeAuth === "keypair"
                      ? "border-cyan-300 bg-white text-cyan-700"
                      : "border-border-primary bg-bg-primary text-text-muted hover:bg-bg-hover"
                  }`}
                >
                  <KeyRound size={10} /> Key Pair (RSA)
                </button>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {fields.filter((f) => !f.multiline).map((f) => (
                <div key={f.key}>
                  <label className="text-[10px] text-text-muted font-medium block mb-0.5">
                    {f.label} {f.required && <span className="text-red-400">*</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={f.secret && !showSecrets[f.key] ? "password" : (f.type || "text")}
                      value={formValues[f.key] || ""}
                      onChange={(e) => handleFieldChange(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      className="w-full px-2 py-1 text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent-blue"
                    />
                    {f.secret && (
                      <button onClick={() => setShowSecrets((p) => ({ ...p, [f.key]: !p[f.key] }))}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                        {showSecrets[f.key] ? <EyeOff size={10} /> : <Eye size={10} />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {fields.filter((f) => f.multiline).map((f) => (
              <div key={f.key}>
                <label className="text-[10px] text-text-muted font-medium block mb-0.5">
                  {f.label} {f.required && <span className="text-red-400">*</span>}
                </label>
                <textarea
                  value={formValues[f.key] || ""}
                  onChange={(e) => handleFieldChange(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  rows={4}
                  spellCheck={false}
                  className="w-full px-2 py-1.5 text-[11px] font-mono rounded border border-border-primary bg-bg-primary text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent-blue resize-y"
                />
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1">
              <button onClick={handleTestConnection} disabled={loading}
                className={`flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold rounded-md text-white ${meta.accent} hover:opacity-90 transition-colors disabled:opacity-50`}>
                {loading ? <Loader2 size={11} className="animate-spin" /> : <Plug size={11} />}
                Connect & Browse Schemas
                <ChevronRight size={11} />
              </button>
            </div>
          </div>
        )}

        {/* dbt Repo Step 0: choose repo path */}
        {selectedConnector === "dbt_repo" && step === 0 && (
          <div className={`rounded-xl border ${meta.border} ${meta.bg} p-3.5 space-y-3 shadow-[0_8px_20px_rgba(15,23,42,0.05)]`}>
            <div className={`text-xs font-semibold ${meta.color} flex items-center gap-1.5`}>
              <ConnectorLogo type={selectedConnector} size={20} />
              <span>dbt Repository Connector</span>
            </div>
            <p className="text-[10px] text-text-muted">
              Point to a local dbt project path. DuckCodeModeling will scan dbt YAML files and convert them into a separate
              `.model.yaml` file in a clean target folder.
            </p>
            <div>
              <label className="text-[10px] text-text-muted font-medium block mb-0.5">
                dbt Repository Path <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formValues.repo_path || ""}
                onChange={(e) => handleFieldChange("repo_path", e.target.value)}
                placeholder="/Users/you/dbt-project"
                className="w-full px-2 py-1 text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent-blue"
              />
              <p className="text-[9px] text-text-muted mt-1">
                In Docker mode, use the mounted container path.
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleDbtScan}
                disabled={loading}
                className={`flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold rounded-md text-white ${meta.accent} hover:opacity-90 transition-colors disabled:opacity-50`}
              >
                {loading ? <Loader2 size={11} className="animate-spin" /> : <FolderTree size={11} />}
                Scan dbt YAML Files
                <ChevronRight size={11} />
              </button>
            </div>
          </div>
        )}

        {/* dbt Repo Step 1: review scan + configure conversion */}
        {selectedConnector === "dbt_repo" && step === 1 && dbtScan && (
          <div className={`rounded-xl border ${meta.border} ${meta.bg} p-3.5 space-y-3 shadow-[0_8px_20px_rgba(15,23,42,0.05)]`}>
            <div className="flex items-center justify-between">
              <div className={`text-xs font-semibold ${meta.color} flex items-center gap-1.5`}>
                <ConnectorLogo type={selectedConnector} size={18} />
                <Layers size={12} />
                Review dbt Files
                <span className="text-[10px] font-normal text-text-muted">
                  ({dbtScan.dbtFileCount || 0} detected)
                </span>
              </div>
              <button
                onClick={() => setStep(0)}
                className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary"
              >
                <ChevronLeft size={10} /> Back
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px]">
              <div className="rounded border border-border-primary bg-white/70 px-2 py-1.5">
                <div className="text-text-muted">dbt files</div>
                <div className="text-sm font-semibold text-text-primary">{dbtScan.dbtFileCount || 0}</div>
              </div>
              <div className="rounded border border-border-primary bg-white/70 px-2 py-1.5">
                <div className="text-text-muted">models</div>
                <div className="text-sm font-semibold text-text-primary">{dbtScan.totals?.models || 0}</div>
              </div>
              <div className="rounded border border-border-primary bg-white/70 px-2 py-1.5">
                <div className="text-text-muted">sources</div>
                <div className="text-sm font-semibold text-text-primary">{dbtScan.totals?.sources || 0}</div>
              </div>
              <div className="rounded border border-border-primary bg-white/70 px-2 py-1.5">
                <div className="text-text-muted">semantic</div>
                <div className="text-sm font-semibold text-text-primary">{dbtScan.totals?.semantic_models || 0}</div>
              </div>
              <div className="rounded border border-border-primary bg-white/70 px-2 py-1.5">
                <div className="text-text-muted">metrics</div>
                <div className="text-sm font-semibold text-text-primary">{dbtScan.totals?.metrics || 0}</div>
              </div>
            </div>

            <div className="max-h-44 overflow-y-auto rounded-md border border-border-primary/70 bg-white/70 p-2 space-y-1">
              {dbtScan.dbtFiles.map((f) => (
                <div key={f.path} className="flex items-center gap-2 text-[10px] px-1 py-1 rounded hover:bg-bg-hover/70">
                  <FileText size={11} className="text-text-muted shrink-0" />
                  <span className="truncate flex-1 text-text-primary">{f.path}</span>
                  <span className="text-text-muted shrink-0">
                    m:{f.sections?.models || 0} s:{f.sections?.sources || 0}
                  </span>
                </div>
              ))}
            </div>

            <div className="rounded-md border border-border-primary/80 bg-white/70 p-2.5 space-y-2">
              <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
                Conversion Target
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[10px]">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="dbt-target-mode"
                    checked={dbtTargetMode === "new_subfolder"}
                    onChange={() => setDbtTargetMode("new_subfolder")}
                  />
                  Create separate folder in dbt repo (recommended)
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="dbt-target-mode"
                    checked={dbtTargetMode === "existing_path"}
                    onChange={() => setDbtTargetMode("existing_path")}
                  />
                  Use specific folder path
                </label>
              </div>

              {dbtTargetMode === "new_subfolder" ? (
                <div>
                  <label className="text-[10px] text-text-muted font-medium block mb-0.5">Folder Name</label>
                  <input
                    type="text"
                    value={dbtSubfolderName}
                    onChange={(e) => setDbtSubfolderName(e.target.value)}
                    className="w-full px-2 py-1 text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary focus:outline-none focus:border-accent-blue"
                  />
                  <div className="text-[9px] text-text-muted mt-1">
                    Target: {joinPath(String(formValues.repo_path || ""), dbtSubfolderName || "duckcodemodeling-models")}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-[10px] text-text-muted font-medium block mb-0.5">Target Folder Path</label>
                  <input
                    type="text"
                    value={dbtTargetPath}
                    onChange={(e) => setDbtTargetPath(e.target.value)}
                    placeholder="/Users/you/models/duckcodemodeling"
                    className="w-full px-2 py-1 text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary focus:outline-none focus:border-accent-blue"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-text-muted font-medium block mb-0.5">Project Name</label>
                  <input
                    type="text"
                    value={dbtProjectName}
                    onChange={(e) => setDbtProjectName(e.target.value)}
                    className="w-full px-2 py-1 text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary focus:outline-none focus:border-accent-blue"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-text-muted font-medium block mb-0.5">File Prefix (optional)</label>
                  <input
                    type="text"
                    value={dbtModelName}
                    onChange={(e) => setDbtModelName(e.target.value)}
                    className="w-full px-2 py-1 text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary focus:outline-none focus:border-accent-blue"
                  />
                  <div className="text-[9px] text-text-muted mt-1">
                    Output names use folder + file path, e.g. <code>models_src_schema.model.yaml</code>.
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-[10px] text-text-muted">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={dbtCreateTargetIfMissing}
                    onChange={(e) => setDbtCreateTargetIfMissing(e.target.checked)}
                  />
                  Create target folder if missing
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={dbtAutoOpen}
                    onChange={(e) => setDbtAutoOpen(e.target.checked)}
                  />
                  Auto-open project after conversion
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={dbtOverwrite}
                    onChange={(e) => setDbtOverwrite(e.target.checked)}
                  />
                  Overwrite matching output files
                </label>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleDbtConvert}
                disabled={loading || (dbtScan.dbtFileCount || 0) === 0}
                className={`flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold rounded-md text-white ${meta.accent} hover:opacity-90 transition-colors disabled:opacity-50`}
              >
                {loading ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                Convert to DuckCodeModeling Models
                <ChevronRight size={11} />
              </button>
            </div>
          </div>
        )}

        {/* dbt Repo Step 2: conversion result */}
        {selectedConnector === "dbt_repo" && step === 2 && dbtResult && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-3.5 space-y-2.5 shadow-[0_8px_20px_rgba(22,163,74,0.12)]">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-green-700">
              <CheckCircle2 size={12} />
              dbt Repository Conversion Complete
            </div>
            <div className="text-[11px] text-green-800 grid grid-cols-4 gap-2">
              <div className="text-center p-2 bg-white rounded border border-green-200">
                <div className="text-lg font-bold">{dbtResult.dbtFileCount || 0}</div>
                <div className="text-[9px] text-green-600">dbt Files</div>
              </div>
              <div className="text-center p-2 bg-white rounded border border-green-200">
                <div className="text-lg font-bold">{dbtResult.generatedCount || 0}</div>
                <div className="text-[9px] text-green-600">Generated</div>
              </div>
              <div className="text-center p-2 bg-white rounded border border-green-200">
                <div className="text-lg font-bold">{dbtResult.failedCount || 0}</div>
                <div className="text-[9px] text-green-600">Failed</div>
              </div>
              <div className="text-center p-2 bg-white rounded border border-green-200">
                <div className="text-lg font-bold">{dbtResult.fieldCount || 0}</div>
                <div className="text-[9px] text-green-600">Total Fields</div>
              </div>
            </div>
            <div className="text-[10px] text-green-700">
              Project: <strong>{dbtResult.project?.name}</strong>
              <span className="text-green-600"> ({dbtResult.project?.path})</span>
            </div>
            {Array.isArray(dbtResult.generatedFiles) && dbtResult.generatedFiles.length > 0 && (
              <div className="rounded border border-green-200 bg-white/80 p-2 space-y-1 max-h-44 overflow-y-auto">
                <div className="text-[10px] font-semibold text-green-700 uppercase tracking-wider">Generated Files</div>
                {dbtResult.generatedFiles.map((item) => (
                  <div key={`${item.sourcePath}:${item.fileName}`} className="text-[10px] text-green-800">
                    <div className="font-medium">{item.fileName}</div>
                    <div className="text-green-700 truncate">{item.sourcePath}</div>
                  </div>
                ))}
              </div>
            )}
            {Array.isArray(dbtResult.failedFiles) && dbtResult.failedFiles.length > 0 && (
              <div className="rounded border border-amber-200 bg-amber-50/70 p-2 space-y-1 max-h-36 overflow-y-auto">
                <div className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">Failed Files</div>
                {dbtResult.failedFiles.map((item) => (
                  <div key={`${item.sourcePath}:${item.error}`} className="text-[10px] text-amber-800">
                    <div className="font-medium">{item.sourcePath}</div>
                    <div className="truncate">{item.error}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={async () => {
                  if (!dbtResult?.project?.id) return;
                  await selectProject(dbtResult.project.id);
                  setBottomPanelTab("properties");
                }}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-md text-white bg-green-500 hover:bg-green-600 transition-colors"
              >
                <CheckCircle2 size={11} /> Open Project
              </button>
              <button
                onClick={() => { setStep(0); setDbtResult(null); }}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium rounded-md border border-border-primary bg-bg-primary text-text-secondary hover:bg-bg-hover transition-colors"
              >
                <RefreshCw size={11} /> Convert Another Repo
              </button>
            </div>
          </div>
        )}

        {/* Step 1: Schema browser — multi-select */}
        {selectedConnector && selectedConnector !== "dbt_repo" && step === 1 && (
          <div className={`rounded-xl border ${meta.border} ${meta.bg} p-3.5 space-y-2.5 shadow-[0_8px_20px_rgba(15,23,42,0.05)]`}>
            <div className="flex items-center justify-between">
              <div className={`text-xs font-semibold ${meta.color} flex items-center gap-1.5`}>
                <ConnectorLogo type={selectedConnector} size={18} />
                <Layers size={12} />
                Select Schemas
                <span className="text-[10px] font-normal text-text-muted">
                  ({selectedSchemas.size}/{schemas.length} selected — each becomes a separate model file)
                </span>
              </div>
              <button onClick={() => { setStep(0); setConnected(false); }}
                className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary">
                <ChevronLeft size={10} /> Back
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={16} className="animate-spin text-text-muted" />
                <span className="ml-2 text-[11px] text-text-muted">Loading schemas...</span>
              </div>
            ) : schemas.length === 0 ? (
              <div className="text-[11px] text-text-muted text-center py-3">No schemas found.</div>
            ) : (
              <>
                {/* Select all / none */}
                <div className="flex items-center gap-2 pb-1 border-b border-border-primary/50">
                  <button onClick={toggleAllSchemas}
                    className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary">
                    {selectedSchemas.size === schemas.length ? <CheckSquare size={11} /> : <Square size={11} />}
                    {selectedSchemas.size === schemas.length ? "Deselect all" : "Select all"}
                  </button>
                  <span className="text-[9px] text-text-muted ml-auto">
                    {schemas.reduce((s, sc) => s + (sc.table_count || 0), 0)} total tables across {schemas.length} schemas
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-52 overflow-y-auto">
                  {schemas.map((s) => {
                    const checked = selectedSchemas.has(s.name);
                    return (
                      <div key={s.name} className="flex items-center gap-1">
                        <button onClick={() => toggleSchema(s.name)}
                          className={`flex items-center gap-2 flex-1 px-2.5 py-2 rounded-md border text-left transition-colors text-[11px] ${
                            checked
                              ? `${meta.border} bg-white/80 ${meta.color} font-semibold`
                              : "border-border-primary bg-bg-primary text-text-secondary opacity-60 hover:opacity-80"
                          }`}>
                          {checked ? <CheckSquare size={11} className={meta.color} /> : <Square size={11} className="text-text-muted" />}
                          <Layers size={10} className="shrink-0" />
                          <span className="truncate flex-1">{s.name}</span>
                          <span className="text-[9px] text-text-muted shrink-0">{s.table_count} tbl</span>
                        </button>
                        {checked && (
                          <button onClick={() => { fetchTablesPreview(s.name); setStep(2); }}
                            title="Preview & filter tables"
                            className="p-1.5 rounded border border-border-primary bg-bg-primary text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors">
                            <Eye size={10} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Pull button */}
                <div className="flex items-center gap-2 pt-1">
                  <div className="min-w-[250px] rounded-md border border-border-primary/80 bg-white/70 px-2 py-1.5">
                    <label className="text-[9px] uppercase tracking-wider text-text-muted font-semibold block mb-1">
                      Target Project Folder
                    </label>
                    <select
                      value={targetProjectId}
                      onChange={(e) => setTargetProjectId(e.target.value)}
                      className="w-full text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary px-2 py-1 focus:outline-none focus:border-accent-blue"
                    >
                      <option value="">Select a project</option>
                      {(projects || []).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <div className="text-[9px] text-text-muted mt-1 truncate">
                      {selectedTargetProject?.path || "Choose where pulled .model.yaml files should be saved"}
                    </div>
                  </div>
                  <button onClick={handlePull} disabled={loading || selectedSchemas.size === 0}
                    className={`flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold rounded-md text-white ${meta.accent} hover:opacity-90 transition-colors disabled:opacity-50`}>
                    {loading ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                    Pull {selectedSchemas.size} Schema{selectedSchemas.size !== 1 ? "s" : ""} as Separate Models
                    <ChevronRight size={11} />
                  </button>
                  <span className="text-[9px] text-text-muted">
                    Creates {selectedSchemas.size} .model.yaml file{selectedSchemas.size !== 1 ? "s" : ""}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 2: Table preview for a specific schema */}
        {selectedConnector && selectedConnector !== "dbt_repo" && step === 2 && previewSchema && (
          <div className={`rounded-xl border ${meta.border} ${meta.bg} p-3.5 space-y-2.5 shadow-[0_8px_20px_rgba(15,23,42,0.05)]`}>
            <div className="flex items-center justify-between">
              <div className={`text-xs font-semibold ${meta.color} flex items-center gap-1.5`}>
                <ConnectorLogo type={selectedConnector} size={18} />
                <Table2 size={12} />
                {previewSchema}
                <span className="text-[10px] font-normal text-text-muted">
                  ({(schemaTableSelections[previewSchema] || new Set()).size}/{previewTables.length} tables selected)
                </span>
              </div>
              <button onClick={() => { setStep(1); setPreviewSchema(null); }}
                className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary">
                <ChevronLeft size={10} /> Back to Schemas
              </button>
            </div>

            <div className="text-[10px] text-text-muted bg-white/50 rounded px-2 py-1 border border-border-primary/30">
              Filter tables for <strong>{previewSchema}</strong>. Uncheck tables you don't want to import. This schema will become <strong>{previewSchema}.model.yaml</strong>.
            </div>

            {/* Select all / none */}
            <div className="flex items-center gap-2 pb-1 border-b border-border-primary/50">
              <button onClick={toggleAllPreviewTables}
                className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary">
                {(schemaTableSelections[previewSchema] || new Set()).size === previewTables.length ? <CheckSquare size={11} /> : <Square size={11} />}
                {(schemaTableSelections[previewSchema] || new Set()).size === previewTables.length ? "Deselect all" : "Select all"}
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={16} className="animate-spin text-text-muted" />
                <span className="ml-2 text-[11px] text-text-muted">Loading tables...</span>
              </div>
            ) : (
              <div className="max-h-44 overflow-y-auto space-y-0.5">
                {previewTables.map((t) => {
                  const checked = (schemaTableSelections[previewSchema] || new Set()).has(t.name);
                  return (
                    <button key={t.name} onClick={() => togglePreviewTable(t.name)}
                      className={`flex items-center gap-2 w-full px-2 py-1 rounded text-[11px] text-left transition-colors ${
                        checked ? "bg-white/60" : "opacity-50 hover:opacity-80"
                      }`}>
                      {checked ? <CheckSquare size={11} className={meta.color} /> : <Square size={11} className="text-text-muted" />}
                      <Table2 size={10} className="text-text-muted shrink-0" />
                      <span className="flex-1 truncate font-medium">{t.name}</span>
                      <span className="text-[9px] text-text-muted">{t.type}</span>
                      <span className="text-[9px] text-text-muted w-12 text-right">{t.column_count} cols</span>
                      {t.row_count != null && (
                        <span className="text-[9px] text-text-muted w-16 text-right">{Number(t.row_count).toLocaleString()} rows</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => { setStep(1); setPreviewSchema(null); }}
                className={`flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold rounded-md text-white ${meta.accent} hover:opacity-90 transition-colors`}>
                <Check size={11} /> Done — Back to Schemas
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Pull result — per-schema breakdown */}
        {selectedConnector && selectedConnector !== "dbt_repo" && step === 3 && pullResult && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-3.5 space-y-2.5 shadow-[0_8px_20px_rgba(22,163,74,0.12)]">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-green-700">
              <CheckCircle2 size={12} />
              {pullResult.schemasProcessed === 1 ? "Schema Pulled Successfully" : `${pullResult.schemasProcessed} Schemas Pulled as Separate Model Files`}
              {pullResult.schemasFailed > 0 && (
                <span className="text-[10px] font-normal text-amber-600">({pullResult.schemasFailed} failed)</span>
              )}
            </div>

            {/* Totals */}
            <div className="text-[11px] text-green-800 grid grid-cols-4 gap-2">
              <div className="text-center p-2 bg-white rounded border border-green-200">
                <div className="text-lg font-bold">{pullResult.schemasProcessed || 0}</div>
                <div className="text-[9px] text-green-600">Model Files</div>
              </div>
              <div className="text-center p-2 bg-white rounded border border-green-200">
                <div className="text-lg font-bold">{pullResult.totalEntities || 0}</div>
                <div className="text-[9px] text-green-600">Tables</div>
              </div>
              <div className="text-center p-2 bg-white rounded border border-green-200">
                <div className="text-lg font-bold">{pullResult.totalFields || 0}</div>
                <div className="text-[9px] text-green-600">Columns</div>
              </div>
              <div className="text-center p-2 bg-white rounded border border-green-200">
                <div className="text-lg font-bold">{pullResult.totalRelationships || 0}</div>
                <div className="text-[9px] text-green-600">Relationships</div>
              </div>
            </div>

            {/* Per-schema breakdown */}
            {pullResult.results && pullResult.results.length > 1 && (
              <div className="space-y-1">
                <div className="text-[10px] text-green-700 font-semibold uppercase tracking-wider">Per-Schema Files</div>
                <div className="max-h-32 overflow-y-auto space-y-0.5">
                  {pullResult.results.map((r) => (
                    <div key={r.schema} className={`flex items-center gap-2 px-2 py-1 rounded text-[11px] ${r.success ? "bg-white/60" : "bg-red-50"}`}>
                      {r.success ? <CheckCircle2 size={10} className="text-green-500 shrink-0" /> : <AlertCircle size={10} className="text-red-500 shrink-0" />}
                      <span className="font-semibold truncate flex-1">{r.schema}.model.yaml</span>
                      {r.success ? (
                        <>
                          <span className="text-[9px] text-text-muted">{r.entityCount} tbl</span>
                          <span className="text-[9px] text-text-muted">{r.fieldCount} col</span>
                          <span className="text-[9px] text-text-muted">{r.relationshipCount} rel</span>
                        </>
                      ) : (
                        <span className="text-[9px] text-red-500 truncate">{r.error}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => setBottomPanelTab("properties")}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-md text-white bg-green-500 hover:bg-green-600 transition-colors">
                <CheckCircle2 size={11} /> View Model
              </button>
              <button onClick={() => { resetWizard(); }}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium rounded-md border border-border-primary bg-bg-primary text-text-secondary hover:bg-bg-hover transition-colors">
                <RefreshCw size={11} /> Pull Another Database
              </button>
            </div>
            {selectedTargetProject && (
              <div className="text-[10px] text-green-700">
                Saved to project: <strong>{selectedTargetProject.name}</strong>
                <span className="text-green-600"> ({selectedTargetProject.path})</span>
              </div>
            )}

            {/* YAML preview for single-schema pulls */}
            {pullResult.results?.length === 1 && pullResult.results[0]?.yaml && (
              <details className="mt-1">
                <summary className="text-[10px] text-green-600 cursor-pointer hover:underline">View generated YAML</summary>
                <pre className="mt-1 p-2 bg-white rounded border border-green-200 text-[10px] font-mono text-text-primary overflow-x-auto max-h-48 overflow-y-auto">
                  {pullResult.results[0].yaml}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
            <AlertCircle size={12} className="text-red-500 mt-0.5 shrink-0" />
            <div className="text-[11px] text-red-700 flex-1">{error}</div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 shrink-0">
              <RefreshCw size={10} />
            </button>
          </div>
        )}

        {/* Help text */}
        {!selectedConnector && (
          <div className="text-[11px] text-text-muted p-4 text-center space-y-1 rounded-xl border border-border-primary/80 bg-white/85 backdrop-blur-sm">
            <p>Select a connector above to import metadata into a DuckCodeModeling model.</p>
            <p className="text-[10px]">
              Database flow: <strong>Connect</strong> → <strong>Browse Schemas</strong> → <strong>Select Tables</strong> → <strong>Pull Model</strong>
            </p>
          </div>
        )}
        </div>{/* end max-w-3xl */}
      </div>
    </div>
  );
}
