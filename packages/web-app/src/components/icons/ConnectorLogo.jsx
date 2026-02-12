import React from "react";
import { Database } from "lucide-react";

const BRAND = {
  dbt_repo: { bg: "from-[#1d4ed8] to-[#0ea5e9]", ring: "ring-[#bfdbfe]" },
  postgres: { bg: "from-[#1b4f8f] to-[#2f7cc1]", ring: "ring-[#b8d6f5]" },
  mysql: { bg: "from-[#0e5f8f] to-[#e48422]", ring: "ring-[#f3d3a9]" },
  snowflake: { bg: "from-[#38bdf8] to-[#0ea5e9]", ring: "ring-[#bae6fd]" },
  bigquery: { bg: "from-[#3b82f6] to-[#60a5fa]", ring: "ring-[#bfdbfe]" },
  databricks: { bg: "from-[#f87171] to-[#ef4444]", ring: "ring-[#fecaca]" },
};

function Glyph({ type }) {
  if (type === "dbt_repo") {
    return (
      <svg viewBox="0 0 24 24" className="w-[74%] h-[74%]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 7.5h6l2 2h9v8.5A2 2 0 0 1 18.5 20h-13a2 2 0 0 1-2-2z" />
        <path d="M8 13h8M8 16h5" />
      </svg>
    );
  }
  if (type === "snowflake") {
    return (
      <svg viewBox="0 0 24 24" className="w-[70%] h-[70%]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M12 4v16M4 12h16M6.5 6.5l11 11M17.5 6.5l-11 11" />
      </svg>
    );
  }
  if (type === "bigquery") {
    return (
      <svg viewBox="0 0 24 24" className="w-[74%] h-[74%]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z" />
        <path d="M9.5 10.5a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0Z" />
        <path d="m15.6 12.6 1.8 1.8" />
      </svg>
    );
  }
  if (type === "databricks") {
    return (
      <svg viewBox="0 0 24 24" className="w-[74%] h-[74%]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="m4 7 8-4 8 4-8 4z" />
        <path d="m4 12 8-4 8 4-8 4z" />
        <path d="m4 17 8-4 8 4-8 4z" />
      </svg>
    );
  }
  if (type === "postgres") {
    return (
      <svg viewBox="0 0 24 24" className="w-[74%] h-[74%]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.5 8.5c0-3 2.2-5 5.5-5s5.5 2 5.5 5v6.2c0 2.3-1.4 3.8-3.5 3.8-.9 0-1.7-.2-2.5-.8-.8.6-1.6.8-2.5.8-2.1 0-3.5-1.5-3.5-3.8z" />
        <path d="M9 9.5h.01M15 9.5h.01" />
        <path d="M10.5 13c1 .8 2 .8 3 0" />
      </svg>
    );
  }
  if (type === "mysql") {
    return (
      <svg viewBox="0 0 24 24" className="w-[74%] h-[74%]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 14c2.5-3.8 5.9-5.8 10.2-6.1 2.2-.2 4 .5 5.8 2.1" />
        <path d="M7.5 12.8c.8 2 2.4 3.2 4.8 3.7 1.5.3 3 .2 4.7-.4" />
        <path d="M18.2 8.4 20 6.6M18.7 11 21 11" />
      </svg>
    );
  }
  return <Database size={14} />;
}

export default function ConnectorLogo({ type, size = 26, className = "" }) {
  const style = BRAND[type] || { bg: "from-slate-500 to-slate-600", ring: "ring-slate-300" };
  return (
    <span
      className={`inline-flex items-center justify-center rounded-xl bg-gradient-to-br ${style.bg} text-white shadow-sm ring-1 ${style.ring} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Glyph type={type} />
    </span>
  );
}
