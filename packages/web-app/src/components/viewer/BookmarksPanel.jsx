import React, { useState, useEffect } from "react";
import { Bookmark, Star, X, ChevronDown, ChevronRight } from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import useDiagramStore from "../../stores/diagramStore";

const STORAGE_KEY = "dm_bookmarks";

function loadBookmarks() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch (_) {
    return [];
  }
}

function saveBookmarks(bookmarks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
}

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState(loadBookmarks);

  const addBookmark = (entityName, projectId, modelPath) => {
    const next = [
      { entityName, projectId, modelPath, addedAt: Date.now() },
      ...loadBookmarks().filter((b) => b.entityName !== entityName || b.projectId !== projectId),
    ].slice(0, 50);
    saveBookmarks(next);
    setBookmarks(next);
  };

  const removeBookmark = (entityName, projectId) => {
    const next = loadBookmarks().filter(
      (b) => !(b.entityName === entityName && b.projectId === projectId)
    );
    saveBookmarks(next);
    setBookmarks(next);
  };

  const isBookmarked = (entityName, projectId) =>
    loadBookmarks().some((b) => b.entityName === entityName && b.projectId === projectId);

  return { bookmarks, addBookmark, removeBookmark, isBookmarked };
}

export default function BookmarksPanel() {
  const [expanded, setExpanded] = useState(true);
  const [bookmarks, setBookmarks] = useState(loadBookmarks);
  const { activeProjectId } = useWorkspaceStore();
  const { setActiveActivity, setBottomPanelTab } = useUiStore();
  const { selectEntity, setCenterEntityId } = useDiagramStore();

  useEffect(() => {
    const interval = setInterval(() => {
      setBookmarks(loadBookmarks());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleNavigate = (bookmark) => {
    setActiveActivity("model");
    setBottomPanelTab("properties");
    selectEntity(bookmark.entityName);
    setCenterEntityId(bookmark.entityName);
  };

  const handleRemove = (e, bookmark) => {
    e.stopPropagation();
    const next = bookmarks.filter(
      (b) => !(b.entityName === bookmark.entityName && b.projectId === bookmark.projectId)
    );
    saveBookmarks(next);
    setBookmarks(next);
  };

  const projectBookmarks = bookmarks.filter(
    (b) => !activeProjectId || b.projectId === activeProjectId
  );

  return (
    <div className="mx-2 my-1 px-2 py-1 rounded-lg border border-border-primary/80 bg-bg-surface">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-1 py-1.5 text-[10px] text-text-muted uppercase tracking-wider font-semibold hover:text-text-secondary transition-colors"
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <Bookmark size={10} />
        Bookmarks
        <span className="ml-auto text-[9px] font-normal">{projectBookmarks.length}</span>
      </button>

      {expanded && (
        <div className="max-h-[200px] overflow-y-auto">
          {projectBookmarks.length === 0 ? (
            <div className="px-2 py-3 text-center">
              <Star size={14} className="mx-auto text-text-muted mb-1 opacity-40" />
              <p className="text-[10px] text-text-muted">
                No bookmarks yet.
              </p>
              <p className="text-[10px] text-text-muted mt-0.5">
                Click ★ on any entity to save it here.
              </p>
            </div>
          ) : (
            projectBookmarks.map((bookmark) => (
              <div
                key={`${bookmark.projectId}-${bookmark.entityName}`}
                className="group flex items-center gap-1.5 px-2 py-1 rounded-md text-xs cursor-pointer text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
                onClick={() => handleNavigate(bookmark)}
              >
                <Star size={10} className="shrink-0 text-amber-400" />
                <span className="truncate flex-1">{bookmark.entityName}</span>
                <button
                  onClick={(e) => handleRemove(e, bookmark)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-status-error transition-all"
                  title="Remove bookmark"
                >
                  <X size={9} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
