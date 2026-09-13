/** The shell: the name, a tab per flow, the theme switch, and the open flow. */

import { useEffect, useState } from "react";
import { FlowView } from "./flow-view.tsx";
import { FLOWS } from "./flows/index.ts";
import { useFlowId } from "./route.ts";

type Theme = "system" | "light" | "dark";
const THEMES: Theme[] = ["system", "light", "dark"];
const THEME_KEY = "flows:theme";

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return saved === "light" || saved === "dark" ? saved : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // private window or blocked storage: the choice lasts this visit only
    }
  }, [theme]);
  return [theme, setTheme];
}

export function App() {
  const id = useFlowId();
  const flow = FLOWS.find((f) => f.id === id) ?? FLOWS[0];
  const [theme, setTheme] = useTheme();
  useEffect(() => {
    document.title = `${flow.name} · Citadel Flows`;
  }, [flow]);

  return (
    <div className="wrap">
      <div className="topbar">
        <p className="brand">
          Citadel <span>Flows</span>
        </p>
        <div className="bar-right">
          <nav aria-label="Flows">
            <ul className="tabs">
              {FLOWS.map((f) => (
                <li key={f.id}>
                  <a aria-current={f.id === flow.id ? "page" : undefined} href={`#/${f.id}`}>
                    {f.name}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <fieldset className="theme">
            <legend className="sr">Theme</legend>
            {THEMES.map((t) => (
              <label key={t}>
                <input checked={theme === t} id={`theme-${t}`} name="theme" onChange={() => setTheme(t)} type="radio" />
                {t}
              </label>
            ))}
          </fieldset>
        </div>
      </div>
      <FlowView flow={flow} key={flow.id} />
    </div>
  );
}
