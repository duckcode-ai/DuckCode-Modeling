import useUiStore from "../stores/uiStore";
import useDiagramStore from "../stores/diagramStore";
import useWorkspaceStore from "../stores/workspaceStore";

// Command descriptor: { id, title, section, shortcut?, keywords?, run(ctx) }
export function buildCommands() {
  const ui = useUiStore.getState();
  const diagram = useDiagramStore.getState();
  const workspace = useWorkspaceStore.getState();

  const cmds = [
    {
      id: "file.save",
      title: "Save model",
      section: "File",
      shortcut: "⌘S",
      run: () => workspace.saveActiveFile?.(),
    },
    {
      id: "file.open-project",
      title: "Open project…",
      section: "File",
      run: () => ui.openModal("addProject"),
    },
    {
      id: "view.toggle-sidebar",
      title: "Toggle sidebar",
      section: "View",
      shortcut: "⌘\\",
      run: () => ui.toggleSidebar(),
    },
    {
      id: "view.toggle-bottom-panel",
      title: "Toggle bottom panel",
      section: "View",
      shortcut: "⌘J",
      run: () => ui.toggleBottomPanel(),
    },
    {
      id: "view.toggle-right-panel",
      title: "Toggle inspector",
      section: "View",
      run: () => ui.toggleRightPanel?.(),
    },
    {
      id: "view.toggle-theme",
      title: "Toggle dark mode",
      section: "View",
      shortcut: "⌘D",
      run: () => ui.toggleTheme(),
    },
    {
      id: "diagram.fit",
      title: "Fit diagram",
      section: "Diagram",
      shortcut: "⇧F",
      run: () => diagram.requestFitDiagram(),
    },
    {
      id: "diagram.relayout",
      title: "Auto-layout diagram",
      section: "Diagram",
      run: () => diagram.requestLayoutRefresh(),
    },
    {
      id: "diagram.new",
      title: "New diagram…",
      section: "Diagram",
      run: () => {
        const name = window.prompt(
          "New diagram name",
          `Diagram ${(diagram.diagrams?.length || 0) + 1}`
        );
        if (name && name.trim()) diagram.addDiagram(name.trim());
      },
    },
    {
      id: "settings.open",
      title: "Open settings",
      section: "Settings",
      run: () => ui.openModal("settings"),
    },
    {
      id: "settings.connections",
      title: "Open connections manager",
      section: "Settings",
      run: () => ui.openModal("connectionsManager"),
    },
    {
      id: "git.commit",
      title: "Commit changes…",
      section: "Git",
      run: () => ui.openModal("commit"),
    },
    {
      id: "activity.model",
      title: "Go to Model",
      section: "Navigate",
      shortcut: "⌘1",
      run: () => ui.setActiveActivity("model"),
    },
    {
      id: "activity.connect",
      title: "Go to Connect",
      section: "Navigate",
      shortcut: "⌘2",
      run: () => ui.setActiveActivity("connect"),
    },
    {
      id: "activity.search",
      title: "Go to Search",
      section: "Navigate",
      run: () => ui.setActiveActivity("search"),
    },
  ];

  for (const d of diagram.diagrams || []) {
    cmds.push({
      id: `diagram.switch.${d.id}`,
      title: `Switch to diagram: ${d.name}`,
      section: "Diagram",
      run: () => diagram.selectDiagram(d.id),
    });
  }

  for (const p of workspace.openProjects || []) {
    const project = (workspace.projects || []).find((x) => x.id === p);
    if (!project) continue;
    cmds.push({
      id: `project.switch.${p}`,
      title: `Switch to project: ${project.name || p}`,
      section: "Project",
      run: () => workspace.selectProject(p),
    });
  }

  return cmds;
}

export function fuzzyMatch(query, text) {
  const q = query.toLowerCase().trim();
  if (!q) return { score: 0, matches: [] };
  const lower = text.toLowerCase();
  if (lower.includes(q)) return { score: 100 - (lower.indexOf(q) || 0), matches: [] };
  let qi = 0;
  let score = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) {
      score += 1;
      qi++;
    }
  }
  return qi === q.length ? { score, matches: [] } : null;
}
