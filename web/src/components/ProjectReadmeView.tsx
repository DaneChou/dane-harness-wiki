import { useEffect, useRef, useState } from "react";
import { ApiError, getProjectReadme, saveProjectReadme } from "../api";
import { useTaskboardI18n } from "../i18n";
import type { ActorIdentity, Project, ProjectReadme } from "../types";
import { LinearIcon } from "./LinearIcon";
import { MarkdownDocument } from "./MarkdownDocument";
import "./ProjectReadmeView.css";

interface ProjectReadmeViewProps {
  project: Project;
  currentUser: ActorIdentity;
  onError?: (error: string) => void;
}

function defaultReadmeTemplate(projectName: string, isChinese: boolean): string {
  if (isChinese) {
    return `# ${projectName}

## 📖 项目概述
简要描述项目的核心目标、主要功能以及面向的使用者。

## 🛠️ 技术栈与依赖
- 核心语言与框架：
- 数据存储与中间件：
- 开发与构建工具：

## 🚀 快速开始与开发指南
\`\`\`bash
# 安装依赖
npm install

# 启动本地开发服务
npm run dev
\`\`\`

## 📌 协作规范与 Agent 指南
1. **分支与 PR 规范**：功能分支格式 \`feat/*\` 或 \`fix/*\`。
2. **测试与质量要求**：提交代码前确保本地测试与构建通过。
3. **架构与细节文档**：详细技术规格与长篇文档请放于本地代码库 \`docs/\` 目录。
`;
  }

  return `# ${projectName}

## 📖 Project Overview
Briefly describe the project's core objectives, key features, and target users.

## 🛠️ Tech Stack & Architecture
- Frameworks & Libraries:
- Storage & Infrastructure:
- Development Tools:

## 🚀 Quick Start & Development
\`\`\`bash
# Install dependencies
npm install

# Start local development server
npm run dev
\`\`\`

## 📌 Collaboration & Agent Guidelines
1. **Branch & PR Conventions**: Feature branches should use \`feat/*\` or \`fix/*\`.
2. **Quality & Testing**: Ensure local tests and lint checks pass before pushing.
3. **Detailed Documentation**: Detailed technical specifications and guides should reside in the repository's \`docs/\` folder.
`;
}

export function ProjectReadmeView({
  project,
  currentUser: _currentUser,
  onError,
}: ProjectReadmeViewProps) {
  const { language, text } = useTaskboardI18n();
  const [readme, setReadme] = useState<ProjectReadme | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [editTab, setEditTab] = useState<"write" | "preview">("write");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setEditing(false);
    setSaveError(null);

    getProjectReadme(project.id)
      .then((data) => {
        if (!active) return;
        setReadme(data);
        setDraftContent(data.content);
      })
      .catch((err) => {
        if (!active) return;
        const msg = err instanceof Error ? err.message : String(err);
        onError?.(msg);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [project.id, onError]);

  function handleStartEditing(initialTemplate = false) {
    if (initialTemplate && (!draftContent || !draftContent.trim())) {
      const template = defaultReadmeTemplate(project.name, language === "zh");
      setDraftContent(template);
    } else {
      setDraftContent(readme?.content ?? "");
    }
    setEditing(true);
    setEditTab("write");
    setSaveError(null);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
  }

  function handleCancelEditing() {
    setEditing(false);
    setDraftContent(readme?.content ?? "");
    setSaveError(null);
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);

    try {
      const updated = await saveProjectReadme(
        project.id,
        draftContent,
        readme?.version,
      );
      setReadme(updated);
      setDraftContent(updated.content);
      setEditing(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "VERSION_CONFLICT") {
        setSaveError(
          text(
            "项目说明已被其他协作者或 Agent 更新，请刷新后重试。",
            "Project README was modified elsewhere. Please refresh and try again.",
          ),
        );
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setSaveError(msg);
        onError?.(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  const hasContent = Boolean(readme?.content && readme.content.trim().length > 0);

  if (loading) {
    return (
      <div className="project-readme-loading">
        <div className="project-readme-spinner" />
        <p>{text("正在加载项目说明…", "Loading project README…")}</p>
      </div>
    );
  }

  return (
    <div className="project-readme-container">
      <div className="project-readme-header">
        <div className="project-readme-title-group">
          <span className="project-readme-icon" aria-hidden="true">
            <LinearIcon name="docs" />
          </span>
          <div className="project-readme-title-info">
            <h1 className="project-readme-heading">
              {text("项目说明", "Project README")}
            </h1>
            <div className="project-readme-meta">
              <span className="project-readme-project-badge">{project.name}</span>
              {readme?.updatedAt && (
                <span className="project-readme-timestamp">
                  {text("更新于", "Updated at")}{" "}
                  {new Date(readme.updatedAt).toLocaleDateString(
                    language === "zh" ? "zh-CN" : "en-US",
                    {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    },
                  )}
                </span>
              )}
              {readme && (
                <span className="project-readme-version">
                  v{readme.version}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="project-readme-actions">
          {!editing ? (
            <button
              type="button"
              className="button secondary project-readme-edit-btn"
              onClick={() => handleStartEditing(false)}
            >
              <LinearIcon name="edit" />
              <span>{hasContent ? text("编辑说明", "Edit README") : text("编写说明", "Write README")}</span>
            </button>
          ) : (
            <div className="project-readme-edit-actions">
              <div className="project-readme-tab-toggle" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={editTab === "write"}
                  className={`project-readme-tab${editTab === "write" ? " is-active" : ""}`}
                  onClick={() => setEditTab("write")}
                >
                  <LinearIcon name="edit" />
                  <span>{text("编辑", "Write")}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={editTab === "preview"}
                  className={`project-readme-tab${editTab === "preview" ? " is-active" : ""}`}
                  onClick={() => setEditTab("preview")}
                >
                  <LinearIcon name="eye" />
                  <span>{text("预览", "Preview")}</span>
                </button>
              </div>

              <button
                type="button"
                className="button ghost"
                disabled={saving}
                onClick={handleCancelEditing}
              >
                {text("取消", "Cancel")}
              </button>

              <button
                type="button"
                className="button primary"
                disabled={saving}
                onClick={() => void handleSave()}
              >
                {saving ? text("保存中…", "Saving…") : text("保存", "Save")}
              </button>
            </div>
          )}
        </div>
      </div>

      {saveError && (
        <div className="project-readme-alert error" role="alert">
          <LinearIcon name="alert" />
          <span>{saveError}</span>
        </div>
      )}

      {editing ? (
        <div className="project-readme-editor-wrapper">
          {editTab === "write" ? (
            <div className="project-readme-textarea-wrapper">
              <textarea
                ref={textareaRef}
                className="project-readme-textarea"
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                placeholder={text(
                  "支持标准 Markdown 语法、GFM 表格、代码高亮与 Mermaid 架构流程图…",
                  "Supports standard Markdown, GFM tables, code syntax highlighting, and Mermaid diagrams…",
                )}
                aria-label={text("项目说明内容", "Project README content")}
                rows={24}
              />
              <div className="project-readme-editor-footer">
                <span className="project-readme-char-count">
                  {text(`${draftContent.length} 字符`, `${draftContent.length} characters`)}
                </span>
                <span className="project-readme-tip">
                  {text("💡 提示：更详细的多页文档建议放置于项目本地 docs/ 目录", "💡 Tip: Detailed multi-page docs belong in the local docs/ directory")}
                </span>
              </div>
            </div>
          ) : (
            <div className="project-readme-preview-wrapper markdown-preview-surface">
              {draftContent.trim() ? (
                <MarkdownDocument markdown={draftContent} />
              ) : (
                <p className="project-readme-preview-empty">
                  {text("暂无预览内容", "No content to preview")}
                </p>
              )}
            </div>
          )}
        </div>
      ) : hasContent ? (
        <div className="project-readme-content-wrapper markdown-preview-surface">
          <MarkdownDocument markdown={readme!.content} />
        </div>
      ) : (
        <div className="project-readme-empty-state">
          <div className="project-readme-empty-icon">
            <LinearIcon name="docs" />
          </div>
          <h2 className="project-readme-empty-title">
            {text("项目暂无说明文档", "No README for this project yet")}
          </h2>
          <p className="project-readme-empty-desc">
            {text(
              "为项目撰写全局说明文档，记录项目目标、技术栈、架构与规范，方便团队协作者与 Agent 快速上手。",
              "Create a project README to document goals, architecture, tech stack, and conventions for collaborators and AI agents.",
            )}
          </p>
          <button
            type="button"
            className="button primary project-readme-create-btn"
            onClick={() => handleStartEditing(true)}
          >
            <LinearIcon name="create" />
            <span>{text("开始编写项目说明", "Create Project README")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
