import { useReducer } from "react";
import { createRoot } from "react-dom/client";
import { Sidebar } from "../../src/components/Sidebar";
import { initialState, reducer, StoreContext, type Bot } from "../../src/state/store";
import { setAdvancedMode } from "../../src/lib/interface-mode";
import { setPinnedCircles, setUniversalPins, setSidebarDensity } from "../../src/lib/sidebar-preferences";
import { setShowThreads } from "../../src/lib/thread-preferences";
import { setAnalyticsEnabled } from "../../src/lib/analytics";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
setAdvancedMode(true);
setShowThreads(true);
setUniversalPins(true);
setPinnedCircles(params.get("layout") !== "rows");
setSidebarDensity(params.get("density") === "compact" ? "compact" : "comfortable");
setAnalyticsEnabled(false);
applySkin(params.get("skin") === "atelier" ? "atelier" : "midnight");

const makeBot = (id: string, name: string, pinned = false): Bot => ({
  id, name, threadId: `${id}-0`, title: "", description: "", notifications: true,
  color: "green", unread: false, pinned, section: pinned ? undefined : "Work",
  modelSelection: { instanceId: "claude", model: "fixture" }, messages: [],
  tasks: Array.from({ length: pinned ? 12 : 1 }, (_, index) => ({
    threadId: `${id}-${index}`, title: `${name} report ${index + 1}`,
    createdAt: Date.UTC(2026, 0, 1, 9, index),
  })),
});
const bots = [makeBot("atlas", "Atlas", true), makeBot("beacon", "Beacon", true),
  ...Array.from({ length: 18 }, (_, index) => makeBot(`bot-${index}`, `Juniper ${index + 1}`))];

function Fixture() {
  const [state, dispatch] = useReducer(reducer, { ...initialState, bots, sections: ["Work"] });
  return <StoreContext.Provider value={{ state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}>
    <div className="flex h-screen">
      <Sidebar open onClose={() => {}} />
      <main className="p-8 text-ink"><h1>Isolated pinned sidebar verification</h1><p data-selected-bot>{state.selectedId}</p></main>
    </div>
  </StoreContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
