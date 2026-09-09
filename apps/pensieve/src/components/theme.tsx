/**
 * Light, dark, or the system's choice. The choice is one localStorage key; `.dark` on
 * <html> is what the stylesheet reads (`@custom-variant dark` in styles.css). The root
 * document runs `THEME_SCRIPT` in <head> so the class is on before first paint — this
 * component only reads the same key after mount and keeps the class in step with it.
 */

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "#/lib/utils";

const KEY = "pensieve.theme";
const QUERY = "(prefers-color-scheme: dark)";

export type Theme = "system" | "light" | "dark";

/** Inline, dependency-free, and silent when storage is unavailable. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(KEY)});var d=t==="dark"||(t!=="light"&&matchMedia(${JSON.stringify(QUERY)}).matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia(QUERY).matches);
  document.documentElement.classList.toggle("dark", dark);
}

const OPTIONS: Array<{ icon: typeof SunIcon; label: string; value: Theme }> = [
  { icon: MonitorIcon, label: "System", value: "system" },
  { icon: SunIcon, label: "Light", value: "light" },
  { icon: MoonIcon, label: "Dark", value: "dark" },
];

export function ThemeToggle({ className }: { className?: string }) {
  // Rendered as "system" on the server; the stored choice replaces it after mount.
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => setTheme(read()), []);

  // While following the system, follow it live.
  useEffect(() => {
    if (theme !== "system") {
      return;
    }
    const mq = window.matchMedia(QUERY);
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const choose = (next: Theme) => {
    setTheme(next);
    try {
      if (next === "system") {
        localStorage.removeItem(KEY);
      } else {
        localStorage.setItem(KEY, next);
      }
    } catch {
      // storage unavailable — the choice still applies for this page
    }
    apply(next);
  };

  return (
    <fieldset
      className={cn(
        "inline-flex rounded-md border border-border bg-background p-0.5",
        className
      )}
    >
      <legend className="sr-only">Theme</legend>
      {OPTIONS.map(({ icon: Icon, label, value }) => (
        <button
          aria-label={label}
          aria-pressed={theme === value}
          className={cn(
            "rounded-[5px] p-1.5 transition-colors",
            theme === value
              ? "bg-accent text-foreground"
              : "text-subtle hover:text-foreground"
          )}
          key={value}
          onClick={() => choose(value)}
          title={label}
          type="button"
        >
          <Icon className="size-3.5" strokeWidth={1.75} />
        </button>
      ))}
    </fieldset>
  );
}
