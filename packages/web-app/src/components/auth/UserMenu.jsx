import React, { useState, useRef, useEffect } from "react";
import { LogOut, ChevronDown } from "lucide-react";
import useAuthStore from "../../stores/authStore";

export default function UserMenu() {
  const { user, logout, isAdmin } = useAuthStore();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const initials = (user?.name || user?.username || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setOpen(false);
    await logout();
  };

  if (!user) return null;

  const admin = isAdmin();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border-primary hover:bg-bg-hover transition-colors"
      >
        <div
          className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 ${
            admin ? "bg-blue-500" : "bg-emerald-500"
          }`}
        >
          {initials}
        </div>
        <span className="text-[11px] text-text-secondary hidden sm:block max-w-[80px] truncate">
          {user.name || user.username}
        </span>
        <span
          className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
            admin
              ? "bg-blue-100 text-blue-700"
              : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {admin ? "Admin" : "Viewer"}
        </span>
        <ChevronDown size={10} className="text-text-muted shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-bg-surface border border-border-primary rounded-xl shadow-lg z-50 py-1 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-border-primary">
            <div className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 ${
                  admin ? "bg-blue-500" : "bg-emerald-500"
                }`}
              >
                {initials}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-text-primary truncate">
                  {user.name || user.username}
                </div>
                <div className="text-[10px] text-text-muted truncate">
                  {user.username}
                </div>
              </div>
            </div>
            <div className="mt-2">
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                  admin
                    ? "bg-blue-100 text-blue-700"
                    : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {admin ? "Administrator" : "Viewer"}
              </span>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-text-secondary hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <LogOut size={12} />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
