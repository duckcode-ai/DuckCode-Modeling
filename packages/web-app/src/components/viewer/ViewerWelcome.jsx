import React, { useState } from "react";
import { Search, Database, FileCode2, ArrowRight, BookOpen, Sparkles } from "lucide-react";
import useAuthStore from "../../stores/authStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";

export default function ViewerWelcome() {
  const { user } = useAuthStore();
  const { projects, selectProject } = useWorkspaceStore();
  const { setActiveActivity, setPendingSearchQuery } = useUiStore();
  const [query, setQuery] = useState("");

  const firstName = (user?.name || user?.username || "there").split(" ")[0];

  const handleSearch = (e) => {
    e.preventDefault();
    if (query.trim()) setPendingSearchQuery(query.trim());
    setActiveActivity("search");
  };

  const handleOpenProject = async (project) => {
    await selectProject(project.id);
    setActiveActivity("model");
  };

  return (
    <div className="h-full overflow-auto bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.08),_transparent_50%),linear-gradient(180deg,#f8fbff_0%,#ffffff_52%)]">
      <div className="max-w-[960px] mx-auto px-6 py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-slate-200 text-[11px] font-semibold text-slate-600 shadow-sm mb-4">
            <Sparkles size={12} className="text-blue-600" />
            DuckCodeModeling
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            Welcome back, {firstName}
          </h1>
          <p className="text-slate-500 text-sm">
            Browse your data models, search entities, and explore the data dictionary.
          </p>
        </div>

        {/* Search bar */}
        <form onSubmit={handleSearch} className="max-w-[600px] mx-auto mb-10">
          <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3.5 shadow-[0_8px_30px_rgba(15,23,42,0.06)] focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
            <Search size={18} className="text-slate-400 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search entities, columns, tags, glossary…"
              className="flex-1 bg-transparent text-[15px] text-slate-800 placeholder:text-slate-400 outline-none"
            />
            {query && (
              <button
                type="submit"
                className="flex items-center gap-1 px-3 py-1 rounded-full bg-blue-600 text-white text-[12px] font-medium hover:bg-blue-700 transition-colors"
              >
                Search <ArrowRight size={12} />
              </button>
            )}
          </div>
          <p className="text-center text-[11px] text-slate-400 mt-2">
            Press Enter or click Search to explore your models
          </p>
        </form>

        {/* Quick actions */}
        <div className="flex justify-center gap-3 mb-10">
          <button
            onClick={() => setActiveActivity("search")}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm"
          >
            <Search size={14} className="text-blue-500" />
            Global Search
          </button>
          <button
            onClick={() => setActiveActivity("model")}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm"
          >
            <FileCode2 size={14} className="text-emerald-500" />
            Browse Models
          </button>
        </div>

        {/* Repository cards */}
        {projects.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <Database size={14} className="text-slate-400" />
              Repositories ({projects.length})
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => handleOpenProject(project)}
                  className="group text-left p-4 bg-white rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-md transition-all"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-100 border border-blue-200 flex items-center justify-center shrink-0">
                      <Database size={16} className="text-blue-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-800 truncate group-hover:text-blue-700 transition-colors">
                        {project.name}
                      </div>
                      {project.githubRepo && (
                        <div className="text-[10px] text-slate-400 truncate mt-0.5 font-mono">
                          {project.githubRepo.replace(/^https?:\/\/github\.com\//, "")}
                        </div>
                      )}
                      {project.defaultBranch && (
                        <div className="mt-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-[10px] text-emerald-700 font-mono">
                          {project.defaultBranch}
                        </div>
                      )}
                    </div>
                    <ArrowRight size={14} className="text-slate-300 group-hover:text-blue-400 transition-colors shrink-0 mt-0.5" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {projects.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <Database size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No repositories available yet.</p>
            <p className="text-xs mt-1">Ask an admin to add a project.</p>
          </div>
        )}

        {/* Viewer info */}
        <div className="mt-10 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
          <div className="flex items-center gap-2 font-semibold mb-1">
            <BookOpen size={14} />
            Viewer Access
          </div>
          <p className="text-[12px] text-emerald-600">
            You have read-only access. You can view diagrams, search entities, explore the data dictionary, export diagrams, and browse model history.
          </p>
        </div>
      </div>
    </div>
  );
}
