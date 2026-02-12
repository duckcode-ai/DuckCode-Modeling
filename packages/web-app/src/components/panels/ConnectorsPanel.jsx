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
    { key: "http_path", label: "HTTP Path", placeholder: "/sql/1.0/warehouses/xxxxxxxx", required: true },
    { key: "port", label: "Port", placeholder: "443", type: "number" },
    { key: "token", label: "Access Token", placeholder: "dapi...", secret: true, required: true },
    { key: "catalog", label: "Catalog", placeholder: "main" },
  ],
  sqlserver: [
    { key: "host", label: "Host", placeholder: "sqlserver.company.internal", required: true },
    { key: "port", label: "Port", placeholder: "1433", type: "number" },
    { key: "database", label: "Database", placeholder: "warehouse", required: true },
    { key: "user", label: "User", placeholder: "svc_user", required: true },
    { key: "password", label: "Password", placeholder: "••••••••", secret: true },
    { key: "odbc_driver", label: "ODBC Driver", placeholder: "ODBC Driver 18 for SQL Server" },
    { key: "encrypt", label: "Encrypt", placeholder: "yes" },
    { key: "trust_server_certificate", label: "Trust Server Certificate", placeholder: "yes" },
  ],
  azure_sql: [
    { key: "host", label: "Server", placeholder: "myserver.database.windows.net", required: true },
    { key: "port", label: "Port", placeholder: "1433", type: "number" },
    { key: "database", label: "Database", placeholder: "analytics", required: true },
    { key: "user", label: "User", placeholder: "user", required: true },
    { key: "password", label: "Password", placeholder: "••••••••", secret: true },
    { key: "odbc_driver", label: "ODBC Driver", placeholder: "ODBC Driver 18 for SQL Server" },
    { key: "encrypt", label: "Encrypt", placeholder: "yes" },
    { key: "trust_server_certificate", label: "Trust Server Certificate", placeholder: "yes" },
  ],
  redshift: [
    { key: "host", label: "Cluster Endpoint", placeholder: "mycluster.abc123.us-east-1.redshift.amazonaws.com", required: true },
    { key: "port", label: "Port", placeholder: "5439", type: "number" },
    { key: "database", label: "Database", placeholder: "dev", required: true },
    { key: "user", label: "User", placeholder: "awsuser", required: true },
    { key: "password", label: "Password", placeholder: "••••••••", secret: true },
  ],
  azure_fabric: [
    { key: "host", label: "SQL Endpoint", placeholder: "myworkspace.datawarehouse.fabric.microsoft.com", required: true },
    { key: "port", label: "Port", placeholder: "1433", type: "number" },
    { key: "database", label: "Warehouse", placeholder: "SalesWarehouse", required: true },
    { key: "user", label: "User", placeholder: "fabric_user", required: true },
    { key: "password", label: "Password", placeholder: "••••••••", secret: true },
    { key: "odbc_driver", label: "ODBC Driver", placeholder: "ODBC Driver 18 for SQL Server" },
    { key: "encrypt", label: "Encrypt", placeholder: "yes" },
    { key: "trust_server_certificate", label: "Trust Server Certificate", placeholder: "yes" },
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
  sqlserver: {
    name: "SQL Server",
    tag: "Enterprise",
    color: "text-[#991b1b]",
    bg: "bg-[#fef2f2]",
    border: "border-[#fecaca]",
    accent: "bg-[#b91c1c]",
  },
  azure_sql: {
    name: "Azure SQL",
    tag: "Managed",
    color: "text-[#0f4c81]",
    bg: "bg-[#eff6ff]",
    border: "border-[#bfdbfe]",
    accent: "bg-[#0078d4]",
  },
  redshift: {
    name: "Redshift",
    tag: "Warehouse",
    color: "text-[#7c3aed]",
    bg: "bg-[#f5f3ff]",
    border: "border-[#ddd6fe]",
    accent: "bg-[#ef4444]",
  },
  azure_fabric: {
    name: "Azure Fabric",
    tag: "Lakehouse",
    color: "text-[#1e3a8a]",
    bg: "bg-[#eef2ff]",
    border: "border-[#c7d2fe]",
    accent: "bg-[#1d4ed8]",
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

function formatUtcMigrationTimestamp(date = new Date()) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}${hh}${min}${ss}`;
}

function buildDefaultMigrationPath(projectPath, modelPath, connectorType = "snowflake") {
  const basePath = normalizePath(projectPath || "");
  const modelName = String(modelPath || "model")
    .replace(/\\/g, "/")
    .split("/")
    .pop() || "model";
  const modelStem = sanitizeModelStem(modelName.replace(/\.model\.ya?ml$/i, ""), "model");
  const stamp = formatUtcMigrationTimestamp();
  const connectorFolder = sanitizeModelStem(String(connectorType || "snowflake"), "snowflake");
  return joinPath(basePath, `migrations/${connectorFolder}/${stamp}__${modelStem}.sql`);
}

const FORWARD_GITOPS_CONNECTORS = new Set(["snowflake", "databricks", "bigquery"]);

function toProjectRelativePath(projectPath, filePath) {
  const project = normalizePath(projectPath || "");
  const target = String(filePath || "").replace(/\\/g, "/");
  if (!project || !target) return "";
  const projectPrefix = `${project}/`;
  if (!target.startsWith(projectPrefix)) return target;
  return target.slice(projectPrefix.length);
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

  // GitOps forward engineering
  const [forwardProjectId, setForwardProjectId] = useState("");
  const [forwardModelFiles, setForwardModelFiles] = useState([]);
  const [forwardOldModelPath, setForwardOldModelPath] = useState("");
  const [forwardNewModelPath, setForwardNewModelPath] = useState("");
  const [forwardSqlPreview, setForwardSqlPreview] = useState("");
  const [forwardMigrationOutPath, setForwardMigrationOutPath] = useState("");
  const [forwardGeneratedPath, setForwardGeneratedPath] = useState("");
  const [forwardCommitMessage, setForwardCommitMessage] = useState("chore(model): add generated migration");
  const [forwardGitStatus, setForwardGitStatus] = useState(null);
  const [forwardCommitResult, setForwardCommitResult] = useState(null);
  const [forwardBranchName, setForwardBranchName] = useState("");
  const [forwardBaseBranch, setForwardBaseBranch] = useState("main");
  const [forwardPrTitle, setForwardPrTitle] = useState("model: generated migration");
  const [forwardPrBody, setForwardPrBody] = useState("Automated migration generated by DuckCodeModeling GitOps flow.");
  const [forwardGithubToken, setForwardGithubToken] = useState("");
  const [forwardPushResult, setForwardPushResult] = useState(null);
  const [forwardPrResult, setForwardPrResult] = useState(null);
  const [forwardError, setForwardError] = useState(null);
  const [forwardLoading, setForwardLoading] = useState(false);
  const [forwardStaging, setForwardStaging] = useState(false);
  const [forwardCommitting, setForwardCommitting] = useState(false);
  const [forwardPushing, setForwardPushing] = useState(false);
  const [forwardCreatingPr, setForwardCreatingPr] = useState(false);

  const {
    loadImportedYaml,
    loadMultipleImportedYaml,
    activeProjectId,
    activeFile,
    isDirty,
    saveCurrentFile,
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
    setForwardProjectId("");
    setForwardModelFiles([]);
    setForwardOldModelPath("");
    setForwardNewModelPath("");
    setForwardSqlPreview("");
    setForwardMigrationOutPath("");
    setForwardGeneratedPath("");
    setForwardCommitMessage("chore(model): add generated migration");
    setForwardGitStatus(null);
    setForwardCommitResult(null);
    setForwardBranchName("");
    setForwardBaseBranch("main");
    setForwardPrTitle("model: generated migration");
    setForwardPrBody("Automated migration generated by DuckCodeModeling GitOps flow.");
    setForwardGithubToken("");
    setForwardPushResult(null);
    setForwardPrResult(null);
    setForwardError(null);
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


  const forwardConnectorSupported = FORWARD_GITOPS_CONNECTORS.has(selectedConnector);
  const forwardDialect = forwardConnectorSupported ? selectedConnector : "snowflake";
  const forwardConnectorLabel = CONNECTOR_META[forwardDialect]?.name || "Warehouse";

  const refreshForwardModelFiles = useCallback(async (projectId) => {
    if (!projectId) {
      setForwardModelFiles([]);
      return;
    }
    try {
      const data = await apiGet(`/api/projects/${projectId}/files`);
      const files = (data.files || [])
        .filter((f) => /\.model\.ya?ml$/i.test(String(f.name || "")))
        .map((f) => ({ name: f.name, fullPath: f.fullPath }));
      setForwardModelFiles(files);

      if (files.length > 0) {
        setForwardOldModelPath((prev) => prev || files[0].fullPath);
        setForwardNewModelPath((prev) => {
          if (prev) return prev;
          if (activeFile?.fullPath && files.some((f) => f.fullPath === activeFile.fullPath)) {
            return activeFile.fullPath;
          }
          return files.length > 1 ? files[1].fullPath : files[0].fullPath;
        });
      }
    } catch (err) {
      setForwardError(err.message || String(err));
      setForwardModelFiles([]);
    }
  }, [activeFile?.fullPath]);

  useEffect(() => {
    if (!forwardConnectorSupported || step !== 3 || !pullResult) return;
    const projectId = forwardProjectId || targetProjectId || activeProjectId;
    if (!projectId) return;

    if (!forwardProjectId && (targetProjectId || activeProjectId)) {
      setForwardProjectId(targetProjectId || activeProjectId || "");
    }

    refreshForwardModelFiles(projectId);
  }, [
    forwardConnectorSupported,
    step,
    pullResult,
    forwardProjectId,
    targetProjectId,
    activeProjectId,
    refreshForwardModelFiles,
  ]);

  useEffect(() => {
    if (!forwardConnectorSupported || step !== 3 || !pullResult) return;
    const projectId = forwardProjectId || targetProjectId || activeProjectId;
    if (!projectId) return;

    let cancelled = false;
    (async () => {
      try {
        const status = await apiGet(`/api/git/status?projectId=${encodeURIComponent(projectId)}`);
        if (cancelled) return;
        setForwardGitStatus(status);
        if (status?.branch && status.branch !== "HEAD") {
          setForwardBranchName((prev) => prev || status.branch);
        }
      } catch (_err) {
        if (!cancelled) setForwardGitStatus(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [forwardConnectorSupported, step, pullResult, forwardProjectId, targetProjectId, activeProjectId]);

  const validateForwardModelSelection = () => {
    const oldModel = String(forwardOldModelPath || "").trim();
    const newModel = String(forwardNewModelPath || "").trim();
    if (!oldModel || !newModel) {
      setForwardError("Select both old and new model files.");
      return null;
    }
    if (oldModel === newModel) {
      setForwardError("Old and new model files are the same. Choose two versions for migration diff.");
      return null;
    }
    return { oldModel, newModel };
  };

  const getForwardProjectContext = () => {
    const projectId = forwardProjectId || targetProjectId || activeProjectId;
    if (!projectId) {
      setForwardError("Select a project for GitOps migration flow.");
      return null;
    }
    const project = (projects || []).find((p) => p.id === projectId) || null;
    if (!project) {
      setForwardError("Selected project not found.");
      return null;
    }
    return { projectId, project };
  };

  useEffect(() => {
    if (!forwardConnectorSupported || step !== 3 || !pullResult) return;
    const project = (projects || []).find((p) => p.id === (forwardProjectId || targetProjectId || activeProjectId)) || null;
    if (!project) return;
    if (forwardMigrationOutPath) return;

    const preferredModel = String(forwardNewModelPath || activeFile?.fullPath || "").trim();
    if (!preferredModel) return;
    setForwardMigrationOutPath(buildDefaultMigrationPath(project.path, preferredModel, forwardDialect));
  }, [
    forwardConnectorSupported,
    step,
    pullResult,
    projects,
    forwardProjectId,
    targetProjectId,
    activeProjectId,
    forwardNewModelPath,
    activeFile?.fullPath,
    forwardDialect,
    forwardMigrationOutPath,
  ]);

  const handleForwardPreviewSql = async () => {
    setForwardError(null);

    const selected = validateForwardModelSelection();
    if (!selected) return;

    setForwardLoading(true);
    try {
      const data = await apiPost("/api/forward/migrate", {
        old_model: selected.oldModel,
        new_model: selected.newModel,
        dialect: forwardDialect,
      });
      setForwardSqlPreview(String(data.sql || data.output || "").trim());
      addToast?.({ type: "success", message: "Generated migration SQL preview." });
    } catch (err) {
      setForwardError(err.message || String(err));
    } finally {
      setForwardLoading(false);
    }
  };

  const handleForwardGenerateMigrationFile = async () => {
    setForwardError(null);

    const selected = validateForwardModelSelection();
    if (!selected) return;

    if (isDirty && activeFile?.fullPath && activeFile.fullPath === selected.newModel) {
      setForwardError("Current model has unsaved changes. Save it before generating migration SQL.");
      return;
    }

    const context = getForwardProjectContext();
    if (!context) return;

    const outPath = String(forwardMigrationOutPath || "").trim() || buildDefaultMigrationPath(context.project.path, selected.newModel, forwardDialect);

    setForwardLoading(true);
    setForwardCommitResult(null);
    setForwardPushResult(null);
    setForwardPrResult(null);
    try {
      await apiPost("/api/forward/migrate", {
        old_model: selected.oldModel,
        new_model: selected.newModel,
        dialect: forwardDialect,
        out: outPath,
      });

      const saved = await apiGet(`/api/files?path=${encodeURIComponent(outPath)}`);
      setForwardSqlPreview(String(saved?.content || "").trim());
      setForwardGeneratedPath(outPath);
      setForwardMigrationOutPath(outPath);
      setForwardGitStatus(null);
      addToast?.({ type: "success", message: "Generated migration SQL file for GitOps flow." });
    } catch (err) {
      setForwardError(err.message || String(err));
    } finally {
      setForwardLoading(false);
    }
  };

  const getForwardGitPaths = (projectPath) => {
    const paths = [];
    const newModel = String(forwardNewModelPath || "").trim();
    const generatedPath = String(forwardGeneratedPath || forwardMigrationOutPath || "").trim();
    if (newModel) paths.push(toProjectRelativePath(projectPath, newModel));
    if (generatedPath) paths.push(toProjectRelativePath(projectPath, generatedPath));
    return Array.from(new Set(paths.filter(Boolean)));
  };

  const handleForwardStageForCommit = async () => {
    setForwardError(null);
    const context = getForwardProjectContext();
    if (!context) return;

    const paths = getForwardGitPaths(context.project.path);
    if (paths.length === 0) {
      setForwardError("Generate migration SQL first so files can be staged.");
      return;
    }

    setForwardStaging(true);
    try {
      const status = await apiPost("/api/git/stage", {
        projectId: context.projectId,
        paths,
      });
      setForwardGitStatus(status);
      addToast?.({ type: "success", message: "Staged YAML + migration SQL for commit." });
    } catch (err) {
      setForwardError(err.message || String(err));
    } finally {
      setForwardStaging(false);
    }
  };

  const handleForwardCommit = async () => {
    setForwardError(null);
    const context = getForwardProjectContext();
    if (!context) return;

    const message = String(forwardCommitMessage || "").trim();
    if (!message) {
      setForwardError("Commit message is required.");
      return;
    }

    const paths = getForwardGitPaths(context.project.path);
    if (paths.length === 0) {
      setForwardError("No files selected for commit. Generate and stage migration first.");
      return;
    }

    setForwardCommitting(true);
    setForwardPrResult(null);
    try {
      const commit = await apiPost("/api/git/commit", {
        projectId: context.projectId,
        message,
        paths,
      });
      setForwardCommitResult(commit);
      const status = await apiGet(`/api/git/status?projectId=${encodeURIComponent(context.projectId)}`);
      setForwardGitStatus(status);
      addToast?.({
        type: "success",
        message: `Committed migration changes (${String(commit.commitHash || "").slice(0, 8)}).`,
      });
    } catch (err) {
      setForwardError(err.message || String(err));
    } finally {
      setForwardCommitting(false);
    }
  };

  const handleForwardCreateBranch = async () => {
    setForwardError(null);
    const context = getForwardProjectContext();
    if (!context) return;

    const branch = String(forwardBranchName || "").trim();
    if (!branch) {
      setForwardError("Branch name is required.");
      return;
    }

    setForwardLoading(true);
    try {
      const data = await apiPost("/api/git/branch/create", {
        projectId: context.projectId,
        branch,
      });
      setForwardGitStatus(data);
      setForwardBranchName(data?.branch || branch);
      addToast?.({ type: "success", message: data?.existed ? `Checked out ${branch}.` : `Created branch ${branch}.` });
    } catch (err) {
      setForwardError(err.message || String(err));
    } finally {
      setForwardLoading(false);
    }
  };

  const handleForwardPushBranch = async () => {
    setForwardError(null);
    const context = getForwardProjectContext();
    if (!context) return;

    const branch = String(forwardBranchName || forwardGitStatus?.branch || "").trim();
    if (!branch || branch === "HEAD") {
      setForwardError("Branch name is required before push.");
      return;
    }

    setForwardPushing(true);
    try {
      const push = await apiPost("/api/git/push", {
        projectId: context.projectId,
        branch,
        remote: "origin",
        set_upstream: true,
      });
      setForwardPushResult(push);
      setForwardGitStatus(push);
      addToast?.({ type: "success", message: `Pushed ${branch} to origin.` });
    } catch (err) {
      setForwardError(err.message || String(err));
    } finally {
      setForwardPushing(false);
    }
  };

  const handleForwardCreatePr = async () => {
    setForwardError(null);
    const context = getForwardProjectContext();
    if (!context) return;

    const token = String(forwardGithubToken || "").trim();
    if (!token) {
      setForwardError("GitHub token is required to create PR.");
      return;
    }

    const head = String(forwardBranchName || forwardGitStatus?.branch || "").trim();
    if (!head || head === "HEAD") {
      setForwardError("Head branch is required for PR.");
      return;
    }

    const title = String(forwardPrTitle || "").trim();
    if (!title) {
      setForwardError("PR title is required.");
      return;
    }

    setForwardCreatingPr(true);
    try {
      const pr = await apiPost("/api/git/github/pr", {
        projectId: context.projectId,
        token,
        head,
        base: String(forwardBaseBranch || "main").trim() || "main",
        title,
        body: String(forwardPrBody || ""),
      });
      setForwardPrResult(pr?.pullRequest || pr);
      addToast?.({ type: "success", message: `Opened PR #${pr?.pullRequest?.number || ""}.` });
    } catch (err) {
      setForwardError(err.message || String(err));
    } finally {
      setForwardCreatingPr(false);
    }
  };

  const fieldKey = selectedConnector === "snowflake"
    ? (snowflakeAuth === "keypair" ? "snowflake_keypair" : "snowflake_password")
    : selectedConnector;
  const connectorSteps = selectedConnector === "dbt_repo" ? DBT_STEPS : DB_STEPS;
  const fields = fieldKey ? (CONNECTOR_FIELDS[fieldKey] || []) : [];
  const meta = selectedConnector ? CONNECTOR_META[selectedConnector] : null;
  const selectedTargetProject = (projects || []).find((p) => p.id === targetProjectId) || null;
  const forwardSelectedProject = (projects || []).find((p) => p.id === (forwardProjectId || targetProjectId)) || null;

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
        {/* GitOps forward engineering UI */}
        {forwardConnectorSupported && step === 3 && pullResult && (
          <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3.5 space-y-2.5 shadow-[0_8px_20px_rgba(37,99,235,0.10)]">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-blue-800 flex items-center gap-1.5">
                <ShieldCheck size={12} />
                {`GitOps Migration Flow (${forwardConnectorLabel})`}
              </div>
              <div className="text-[10px] text-blue-700">
                Pull → Edit model → Generate SQL → Commit → PR → CI/CD Apply
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="rounded-md border border-blue-200 bg-white/80 p-2">
                <label className="text-[9px] uppercase tracking-wider text-blue-700 font-semibold block mb-1">
                  Model Project
                </label>
                <div className="flex items-center gap-1.5">
                  <select
                    value={forwardProjectId || targetProjectId || ""}
                    onChange={(e) => {
                      setForwardProjectId(e.target.value);
                      setForwardOldModelPath("");
                      setForwardNewModelPath("");
                      setForwardModelFiles([]);
                      setForwardSqlPreview("");
                      setForwardGeneratedPath("");
                      setForwardBranchName("");
                      setForwardGitStatus(null);
                      setForwardCommitResult(null);
                      setForwardPushResult(null);
                      setForwardPrResult(null);
                      setForwardMigrationOutPath("");
                    }}
                    className="flex-1 text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary px-2 py-1 focus:outline-none focus:border-accent-blue"
                  >
                    <option value="">Select a project</option>
                    {(projects || []).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => refreshForwardModelFiles(forwardProjectId || targetProjectId || activeProjectId)}
                    className="px-2 py-1 rounded border border-border-primary bg-bg-primary text-[10px] text-text-secondary hover:bg-bg-hover"
                  >
                    <RefreshCw size={10} />
                  </button>
                </div>
                <div className="text-[9px] text-blue-700 mt-1 truncate">
                  {forwardSelectedProject?.path || "Select where your .model.yaml files live"}
                </div>
              </div>

              <div className="rounded-md border border-blue-200 bg-white/80 p-2">
                <label className="text-[9px] uppercase tracking-wider text-blue-700 font-semibold block mb-1">
                  GitOps Artifact
                </label>
                <input
                  type="text"
                  value={forwardMigrationOutPath}
                  onChange={(e) => setForwardMigrationOutPath(e.target.value)}
                  placeholder={`/repo/migrations/${forwardDialect}/<timestamp>__model.sql`}
                  className="w-full text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary px-2 py-1 focus:outline-none focus:border-accent-blue"
                />
                <p className="text-[9px] text-blue-700 mt-1">
                  Generate SQL into your modeling repo, then commit + PR.
                </p>
              </div>
            </div>

            <datalist id="forward-model-files">
              {forwardModelFiles.map((f) => (
                <option key={f.fullPath} value={f.fullPath}>
                  {f.name}
                </option>
              ))}
            </datalist>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-text-muted font-medium block mb-0.5">Old Model Path</label>
                <input
                  type="text"
                  list="forward-model-files"
                  value={forwardOldModelPath}
                  onChange={(e) => setForwardOldModelPath(e.target.value)}
                  placeholder="/path/to/old.model.yaml"
                  className="w-full px-2 py-1 text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary focus:outline-none focus:border-accent-blue"
                />
              </div>
              <div>
                <label className="text-[10px] text-text-muted font-medium block mb-0.5">New Model Path</label>
                <input
                  type="text"
                  list="forward-model-files"
                  value={forwardNewModelPath}
                  onChange={(e) => setForwardNewModelPath(e.target.value)}
                  placeholder="/path/to/new.model.yaml"
                  className="w-full px-2 py-1 text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary focus:outline-none focus:border-accent-blue"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-text-muted font-medium block mb-0.5">Commit Message</label>
                <input
                  type="text"
                  value={forwardCommitMessage}
                  onChange={(e) => setForwardCommitMessage(e.target.value)}
                  placeholder="chore(model): add migration"
                  className="w-full px-2 py-1 text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary focus:outline-none focus:border-accent-blue"
                />
              </div>
              <div>
                <label className="text-[10px] text-text-muted font-medium block mb-0.5">Feature Branch</label>
                <input
                  type="text"
                  value={forwardBranchName}
                  onChange={(e) => setForwardBranchName(e.target.value)}
                  placeholder="feature/model-migration"
                  className="w-full px-2 py-1 text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary focus:outline-none focus:border-accent-blue"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-text-muted font-medium block mb-0.5">PR Title</label>
                <input
                  type="text"
                  value={forwardPrTitle}
                  onChange={(e) => setForwardPrTitle(e.target.value)}
                  placeholder="model: generated migration"
                  className="w-full px-2 py-1 text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary focus:outline-none focus:border-accent-blue"
                />
              </div>
              <div>
                <label className="text-[10px] text-text-muted font-medium block mb-0.5">Base Branch</label>
                <input
                  type="text"
                  value={forwardBaseBranch}
                  onChange={(e) => setForwardBaseBranch(e.target.value)}
                  placeholder="main"
                  className="w-full px-2 py-1 text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary focus:outline-none focus:border-accent-blue"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] text-text-muted font-medium block mb-0.5">PR Description</label>
              <textarea
                value={forwardPrBody}
                onChange={(e) => setForwardPrBody(e.target.value)}
                rows={3}
                className="w-full px-2 py-1 text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary focus:outline-none focus:border-accent-blue"
              />
            </div>

            <div>
              <label className="text-[10px] text-text-muted font-medium block mb-0.5">GitHub Token (repo scope)</label>
              <input
                type="password"
                value={forwardGithubToken}
                onChange={(e) => setForwardGithubToken(e.target.value)}
                placeholder="ghp_..."
                className="w-full px-2 py-1 text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary focus:outline-none focus:border-accent-blue"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                onClick={handleForwardPreviewSql}
                disabled={forwardLoading || forwardStaging || forwardCommitting || forwardPushing || forwardCreatingPr}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-md border border-blue-300 bg-white text-blue-700 hover:bg-blue-50 disabled:opacity-50"
              >
                {forwardLoading ? <Loader2 size={11} className="animate-spin" /> : <FileText size={11} />}
                Preview SQL
              </button>
              <button
                onClick={handleForwardGenerateMigrationFile}
                disabled={forwardLoading || forwardStaging || forwardCommitting || forwardPushing || forwardCreatingPr}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-md text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50"
              >
                {forwardLoading ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                Generate Migration File
              </button>
              <button
                onClick={handleForwardStageForCommit}
                disabled={forwardLoading || forwardStaging || forwardCommitting || forwardPushing || forwardCreatingPr || !forwardGeneratedPath}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-md border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              >
                {forwardStaging ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                Stage Files
              </button>
              <button
                onClick={handleForwardCommit}
                disabled={forwardLoading || forwardStaging || forwardCommitting || forwardPushing || forwardCreatingPr || !forwardGeneratedPath}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-md text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50"
              >
                {forwardCommitting ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                Commit for PR
              </button>
              <button
                onClick={handleForwardCreateBranch}
                disabled={forwardLoading || forwardStaging || forwardCommitting || forwardPushing || forwardCreatingPr}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-md border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
              >
                {forwardLoading ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                Create/Checkout Branch
              </button>
              <button
                onClick={handleForwardPushBranch}
                disabled={forwardLoading || forwardStaging || forwardCommitting || forwardPushing || forwardCreatingPr || !forwardBranchName}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-md border border-purple-300 bg-white text-purple-700 hover:bg-purple-50 disabled:opacity-50"
              >
                {forwardPushing ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                Push Branch
              </button>
              <button
                onClick={handleForwardCreatePr}
                disabled={forwardLoading || forwardStaging || forwardCommitting || forwardPushing || forwardCreatingPr || !forwardGithubToken || !forwardBranchName}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-md text-white bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50"
              >
                {forwardCreatingPr ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                Open GitHub PR
              </button>
              {isDirty && activeFile?.fullPath === forwardNewModelPath && (
                <button
                  onClick={async () => {
                    await saveCurrentFile();
                    addToast?.({ type: "success", message: "Saved current model." });
                  }}
                  className="px-2 py-1 rounded border border-amber-300 bg-amber-50 text-amber-700 font-semibold text-[10px]"
                >
                  Save Current Model
                </button>
              )}
            </div>

            <div className="text-[10px] text-blue-700 bg-blue-100/60 border border-blue-200 rounded px-2 py-1">
              {`Direct apply is disabled in product mode for ${forwardConnectorLabel}. Push branch and open PR in your modeling repository to let CI/CD deploy.`}
            </div>

            {forwardGeneratedPath && (
              <div className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                Generated migration SQL: <strong>{forwardGeneratedPath}</strong>
              </div>
            )}

            {forwardError && (
              <div className="text-[10px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                {forwardError}
              </div>
            )}

            {forwardGitStatus && (
              <details className="rounded border border-blue-200 bg-white/70 p-2">
                <summary className="text-[10px] font-semibold text-blue-700 cursor-pointer">
                  Git Status ({forwardGitStatus.branch || "unknown"})
                </summary>
                <pre className="mt-2 text-[10px] max-h-40 overflow-auto bg-white rounded border border-border-primary p-2">
                  {JSON.stringify(forwardGitStatus, null, 2)}
                </pre>
              </details>
            )}

            {forwardCommitResult && (
              <details className="rounded border border-emerald-200 bg-white/70 p-2" open>
                <summary className="text-[10px] font-semibold text-emerald-700 cursor-pointer">
                  Commit Created ({String(forwardCommitResult.commitHash || "").slice(0, 8)})
                </summary>
                <pre className="mt-2 text-[10px] max-h-40 overflow-auto bg-white rounded border border-border-primary p-2">
                  {String(forwardCommitResult.summary || "")}
                </pre>
              </details>
            )}

            {forwardPushResult && (
              <details className="rounded border border-purple-200 bg-white/70 p-2" open>
                <summary className="text-[10px] font-semibold text-purple-700 cursor-pointer">
                  Branch Pushed ({forwardPushResult.remote || "origin"}/{forwardPushResult.branch || forwardBranchName})
                </summary>
                <pre className="mt-2 text-[10px] max-h-32 overflow-auto bg-white rounded border border-border-primary p-2">
                  {String(forwardPushResult.output || "Push completed")}
                </pre>
              </details>
            )}

            {forwardPrResult?.url && (
              <div className="text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-1">
                Pull Request opened: <a href={forwardPrResult.url} target="_blank" rel="noreferrer" className="underline font-semibold">{forwardPrResult.url}</a>
              </div>
            )}

            {forwardSqlPreview && (
              <details className="rounded border border-blue-200 bg-white/70 p-2" open>
                <summary className="text-[10px] font-semibold text-blue-700 cursor-pointer">
                  Migration SQL Preview
                </summary>
                <pre className="mt-2 text-[10px] max-h-56 overflow-auto bg-white rounded border border-border-primary p-2">
                  {forwardSqlPreview}
                </pre>
              </details>
            )}
          </div>
        )}


        {!forwardConnectorSupported && step === 3 && pullResult && selectedConnector !== "dbt_repo" && (
          <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-3 text-[11px] text-amber-800">
            GitOps migration automation is currently available for Snowflake, Databricks, and BigQuery connectors.
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
