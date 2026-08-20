import type { ImgHTMLAttributes } from "react";
import aiLauncher from "../assets/figma-taskboard/ai-launcher.svg";
import automationPause from "../assets/figma-taskboard/automation-pause.svg";
import automationPlay from "../assets/figma-taskboard/automation-play.svg";
import breadcrumb from "../assets/figma-taskboard/breadcrumb.svg";
import columnAddBlocked from "../assets/figma-taskboard/column-add-blocked.svg";
import columnAddProgress from "../assets/figma-taskboard/column-add-progress.svg";
import columnAddReview from "../assets/figma-taskboard/column-add-review.svg";
import columnAddTodo from "../assets/figma-taskboard/column-add-todo.svg";
import columnAdd from "../assets/figma-taskboard/column-add.svg";
import create from "../assets/figma-taskboard/create.svg";
import dropdown from "../assets/figma-taskboard/dropdown.svg";
import filter from "../assets/figma-taskboard/filter.svg";
import home from "../assets/figma-taskboard/home.svg";
import panel from "../assets/figma-taskboard/panel.svg";
import projectFolder from "../assets/figma-taskboard/project-folder.svg";
import search from "../assets/figma-taskboard/search.svg";
import sidebarAdd from "../assets/figma-taskboard/sidebar-add.svg";

const TASKBOARD_ICONS = {
  aiLauncher,
  automationPause,
  automationPlay,
  breadcrumb,
  columnAdd,
  columnAddBlocked,
  columnAddProgress,
  columnAddReview,
  columnAddTodo,
  create,
  dropdown,
  filter,
  home,
  panel,
  projectFolder,
  search,
  sidebarAdd,
} as const;

export type TaskboardIconName = keyof typeof TASKBOARD_ICONS;

const MONOCHROME_ICONS = new Set<TaskboardIconName>([
  "aiLauncher",
  "automationPlay",
  "breadcrumb",
  "columnAdd",
  "create",
  "dropdown",
  "filter",
  "home",
  "panel",
  "projectFolder",
  "search",
  "sidebarAdd",
]);

export function taskboardIconSource(name: TaskboardIconName) {
  return TASKBOARD_ICONS[name];
}

interface TaskboardIconProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "alt" | "src"> {
  name: TaskboardIconName;
}

export function TaskboardIcon({ name, className, ...props }: TaskboardIconProps) {
  const classes = [
    "taskboard-icon",
    MONOCHROME_ICONS.has(name) ? "taskboard-icon-monochrome" : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  return (
    <img
      {...props}
      className={classes}
      src={TASKBOARD_ICONS[name]}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
