import React, { useMemo, useState } from "react";
import yaml from "js-yaml";
import { BookMarked, Package2, Tag, CaseUpper } from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import useAuthStore from "../../stores/authStore";
import { addDomain, addEnum, addSubjectArea, addTemplate, setNamingRule } from "../../lib/yamlRoundTrip";

const NAMING_TARGETS = ["entity", "field", "relationship", "physical_name", "index"];
const NAMING_STYLES = ["pascal_case", "snake_case", "lower_snake_case", "upper_snake_case"];

function SummaryCard({ label, value }) {
  return (
    <div className="rounded-lg border border-border-primary bg-bg-primary px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{label}</div>
      <div className="text-lg font-semibold text-text-primary mt-1">{value}</div>
    </div>
  );
}

export default function LibrariesPanel() {
  const { activeFileContent, updateContent } = useWorkspaceStore();
  const { addToast } = useUiStore();
  const { canEdit: canEditFn } = useAuthStore();
  const canEdit = canEditFn();

  const [domainName, setDomainName] = useState("");
  const [domainType, setDomainType] = useState("string");
  const [enumName, setEnumName] = useState("");
  const [enumValues, setEnumValues] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [subjectAreaName, setSubjectAreaName] = useState("");
  const [namingTarget, setNamingTarget] = useState("entity");
  const [namingStyle, setNamingStyle] = useState("pascal_case");
  const [namingPattern, setNamingPattern] = useState("");

  const doc = useMemo(() => {
    try {
      return activeFileContent ? yaml.load(activeFileContent) || {} : {};
    } catch (_err) {
      return {};
    }
  }, [activeFileContent]);

  const domains = Array.isArray(doc.domains) ? doc.domains : [];
  const enums = Array.isArray(doc.enums) ? doc.enums : [];
  const templates = Array.isArray(doc.templates) ? doc.templates : [];
  const subjectAreas = Array.isArray(doc.subject_areas) ? doc.subject_areas : [];
  const namingRules = doc.naming_rules && typeof doc.naming_rules === "object" ? doc.naming_rules : {};

  const applyMutation = (result, successMessage, reset) => {
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return;
    }
    updateContent(result.yaml);
    reset?.();
    addToast?.({ type: "success", message: successMessage });
  };

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4">
      <section className="grid grid-cols-2 gap-2">
        <SummaryCard label="Domains" value={domains.length} />
        <SummaryCard label="Enums" value={enums.length} />
        <SummaryCard label="Templates" value={templates.length} />
        <SummaryCard label="Subject Areas" value={subjectAreas.length} />
      </section>

      <section className="rounded-xl border border-border-primary bg-bg-surface p-3 space-y-2">
        <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1.5">
          <BookMarked size={11} />
          Domain Library
        </div>
        <input value={domainName} onChange={(e) => setDomainName(e.target.value)} placeholder="domain name" className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue" disabled={!canEdit} />
        <input value={domainType} onChange={(e) => setDomainType(e.target.value)} placeholder="data type" className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue" disabled={!canEdit} />
        <button onClick={() => applyMutation(addDomain(activeFileContent, domainName, domainType), "Added domain.", () => { setDomainName(""); setDomainType("string"); })} disabled={!canEdit} className="w-full px-3 py-2 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80 disabled:opacity-40 transition-colors">Add Domain</button>
        <div className="flex flex-wrap gap-1">
          {domains.map((domain) => <span key={domain.name} className="px-1.5 py-0.5 rounded border border-border-primary text-[10px] text-text-secondary bg-bg-primary">{domain.name}</span>)}
        </div>
      </section>

      <section className="rounded-xl border border-border-primary bg-bg-surface p-3 space-y-2">
        <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1.5">
          <Tag size={11} />
          Enums And Templates
        </div>
        <input value={enumName} onChange={(e) => setEnumName(e.target.value)} placeholder="enum name" className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue" disabled={!canEdit} />
        <input value={enumValues} onChange={(e) => setEnumValues(e.target.value)} placeholder="enum values (comma separated)" className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue" disabled={!canEdit} />
        <button onClick={() => applyMutation(addEnum(activeFileContent, enumName, enumValues), "Added enum.", () => { setEnumName(""); setEnumValues(""); })} disabled={!canEdit} className="w-full px-3 py-2 rounded-md text-xs font-medium border border-border-primary text-text-secondary hover:bg-bg-hover disabled:opacity-40 transition-colors">Add Enum</button>
        <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="template name" className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue" disabled={!canEdit} />
        <button onClick={() => applyMutation(addTemplate(activeFileContent, templateName), "Added template.", () => setTemplateName(""))} disabled={!canEdit} className="w-full px-3 py-2 rounded-md text-xs font-medium border border-border-primary text-text-secondary hover:bg-bg-hover disabled:opacity-40 transition-colors">Add Template</button>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-bg-primary border border-border-primary p-2">
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Enums</div>
            <div className="flex flex-wrap gap-1 mt-2">
              {enums.map((item) => <span key={item.name} className="px-1.5 py-0.5 rounded border border-border-primary text-[10px] text-text-secondary">{item.name}</span>)}
            </div>
          </div>
          <div className="rounded-lg bg-bg-primary border border-border-primary p-2">
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Templates</div>
            <div className="flex flex-wrap gap-1 mt-2">
              {templates.map((item) => <span key={item.name} className="px-1.5 py-0.5 rounded border border-border-primary text-[10px] text-text-secondary">{item.name}</span>)}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border-primary bg-bg-surface p-3 space-y-2">
        <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1.5">
          <Package2 size={11} />
          Subject Areas
        </div>
        <input value={subjectAreaName} onChange={(e) => setSubjectAreaName(e.target.value)} placeholder="subject area name" className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue" disabled={!canEdit} />
        <button onClick={() => applyMutation(addSubjectArea(activeFileContent, subjectAreaName), "Added subject area.", () => setSubjectAreaName(""))} disabled={!canEdit} className="w-full px-3 py-2 rounded-md text-xs font-medium border border-border-primary text-text-secondary hover:bg-bg-hover disabled:opacity-40 transition-colors">Add Subject Area</button>
        <div className="flex flex-wrap gap-1">
          {subjectAreas.map((area) => <span key={area.name} className="px-1.5 py-0.5 rounded border border-border-primary text-[10px] text-text-secondary">{area.name}</span>)}
        </div>
      </section>

      <section className="rounded-xl border border-border-primary bg-bg-surface p-3 space-y-2">
        <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1.5">
          <CaseUpper size={11} />
          Naming Rules
        </div>
        <select value={namingTarget} onChange={(e) => setNamingTarget(e.target.value)} className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue" disabled={!canEdit}>
          {NAMING_TARGETS.map((target) => <option key={target} value={target}>{target}</option>)}
        </select>
        <select value={namingStyle} onChange={(e) => setNamingStyle(e.target.value)} className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue" disabled={!canEdit}>
          {NAMING_STYLES.map((style) => <option key={style} value={style}>{style}</option>)}
        </select>
        <input value={namingPattern} onChange={(e) => setNamingPattern(e.target.value)} placeholder="optional regex pattern" className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue" disabled={!canEdit} />
        <button onClick={() => applyMutation(setNamingRule(activeFileContent, namingTarget, namingStyle, namingPattern), `Updated ${namingTarget} naming rule.`)} disabled={!canEdit} className="w-full px-3 py-2 rounded-md text-xs font-medium border border-border-primary text-text-secondary hover:bg-bg-hover disabled:opacity-40 transition-colors">Apply Naming Rule</button>
        <div className="space-y-1">
          {NAMING_TARGETS.map((target) => {
            const rule = namingRules[target];
            return (
              <div key={target} className="flex items-center gap-2 rounded-lg border border-border-primary bg-bg-primary px-2 py-1.5 text-[10px]">
                <span className="font-semibold text-text-secondary min-w-[84px]">{target}</span>
                <span className="text-text-muted">{rule?.style || "unset"}</span>
                {rule?.pattern && <code className="text-text-muted truncate">{rule.pattern}</code>}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
