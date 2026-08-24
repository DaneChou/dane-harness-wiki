import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { taskStatusLabel, useTaskboardI18n } from "../i18n";
import {
  BOARD_STATUS_ORDER,
  MAIN_STATUSES,
  SECONDARY_STATUSES,
} from "../issueBoardStatuses";
import type { TaskStatus } from "../types";
import { LinearIcon } from "./LinearIcon";
import { StatusIcon } from "./SemanticIcons";

export type BoardStatusPlacement = "main" | "sidebar" | "hidden";

export interface BoardDisplaySettings {
  cover: boolean;
  body: boolean;
  mainStatuses: TaskStatus[];
  sidebarStatuses: TaskStatus[];
}

export const DEFAULT_BOARD_DISPLAY_SETTINGS: BoardDisplaySettings = {
  cover: true,
  body: false,
  mainStatuses: [...MAIN_STATUSES],
  sidebarStatuses: [...SECONDARY_STATUSES],
};

interface BoardCardDisplayMenuProps {
  projectName: string;
  settings: BoardDisplaySettings;
  onChange: (value: BoardDisplaySettings) => void;
  onReset: () => void;
}

export function BoardCardDisplayMenu({
  projectName,
  settings,
  onChange,
  onReset,
}: BoardCardDisplayMenuProps) {
  const { language, text } = useTaskboardI18n();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function closeFromEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [open]);

  function statusPlacement(status: TaskStatus): BoardStatusPlacement {
    if (settings.mainStatuses.includes(status)) return "main";
    if (settings.sidebarStatuses.includes(status)) return "sidebar";
    return "hidden";
  }

  function moveStatus(status: TaskStatus, placement: BoardStatusPlacement) {
    onChange({
      ...settings,
      mainStatuses: BOARD_STATUS_ORDER.filter((candidate) => (
        candidate === status
          ? placement === "main"
          : settings.mainStatuses.includes(candidate)
      )),
      sidebarStatuses: BOARD_STATUS_ORDER.filter((candidate) => (
        candidate === status
          ? placement === "sidebar"
          : settings.sidebarStatuses.includes(candidate)
      )),
    });
  }

  const dialog = open ? createPortal(
    <div
      className="display-settings-backdrop no-drag"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        className="display-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="display-settings-title"
      >
        <header className="display-settings-header">
          <div>
            <h2 id="display-settings-title">{text("显示设置", "Display settings")}</h2>
            <p>{projectName}</p>
          </div>
          <button
            ref={closeRef}
            className="icon-button display-settings-close"
            type="button"
            aria-label={text("关闭显示设置", "Close display settings")}
            onClick={() => setOpen(false)}
          >
            <LinearIcon name="close" />
          </button>
        </header>

        <div className="display-settings-content">
          <section className="display-settings-section">
            <div className="display-settings-section-heading">
              <div>
                <h3>{text("状态位置", "Status placement")}</h3>
                <p>{text(
                  "选择每个状态显示在默认面板、侧边栏或不显示。",
                  "Choose whether each status appears on the main board, in the sidebar, or stays hidden.",
                )}</p>
              </div>
            </div>
            <div className="display-settings-status-list">
              {BOARD_STATUS_ORDER.map((status) => {
                const placement = statusPlacement(status);
                const label = taskStatusLabel(language, status);
                return (
                  <div className="display-settings-status-row" key={status}>
                    <span className="display-settings-status-label">
                      <StatusIcon status={status} color="currentColor" size={15} />
                      {label}
                    </span>
                    <div className="display-settings-placement" role="group" aria-label={label}>
                      {([
                        ["main", text("默认面板", "Main board")],
                        ["sidebar", text("侧边栏", "Sidebar")],
                        ["hidden", text("隐藏", "Hidden")],
                      ] as const).map(([value, optionLabel]) => (
                        <button
                          className={placement === value ? "is-active" : ""}
                          type="button"
                          aria-pressed={placement === value}
                          onClick={() => moveStatus(status, value)}
                          key={value}
                        >
                          {optionLabel}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="display-settings-note">{text(
              "已归档议题固定保留在侧边栏。没有议题时，阻塞列仍会自动隐藏。",
              "Archived issues always stay in the sidebar. The Blocked column still hides automatically when empty.",
            )}</p>
          </section>

          <section className="display-settings-section display-settings-card-section">
            <div className="display-settings-section-heading">
              <div>
                <h3>{text("卡片内容", "Card content")}</h3>
                <p>{text("控制默认面板和侧边栏中的卡片内容。", "Control card content on the main board and in the sidebar.")}</p>
              </div>
            </div>
            <div className="display-settings-switch-row">
              <span>{text("封面", "Cover")}</span>
              <button
                type="button"
                className={`board-setting-switch${settings.cover ? " is-on" : ""}`}
                role="switch"
                aria-label={text("显示封面", "Show cover")}
                aria-checked={settings.cover}
                onClick={() => onChange({ ...settings, cover: !settings.cover })}
              >
                <span aria-hidden="true" />
              </button>
            </div>
            <div className="display-settings-switch-row">
              <span>{text("正文", "Body")}</span>
              <button
                type="button"
                className={`board-setting-switch${settings.body ? " is-on" : ""}`}
                role="switch"
                aria-label={text("显示正文", "Show body")}
                aria-checked={settings.body}
                onClick={() => onChange({ ...settings, body: !settings.body })}
              >
                <span aria-hidden="true" />
              </button>
            </div>
          </section>
        </div>

        <footer className="display-settings-footer">
          <button className="button secondary" type="button" onClick={onReset}>
            {text("重置为默认", "Reset to default")}
          </button>
          <button className="button primary" type="button" onClick={() => setOpen(false)}>
            {text("完成", "Done")}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        className={`task-filter-trigger board-card-display-trigger${open ? " is-open" : ""}`}
        type="button"
        aria-label={text("显示设置", "Display settings")}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={text("显示设置", "Display settings")}
        onClick={() => setOpen((current) => !current)}
      >
        <LinearIcon name="displayOptions" />
      </button>
      {dialog}
    </>
  );
}
