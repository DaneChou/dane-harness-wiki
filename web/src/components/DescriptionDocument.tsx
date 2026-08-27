import type { ClipboardEvent, MouseEvent } from "react";
import { attachmentContentUrl } from "../api";
import { readIssueIdentifier } from "../issueRoute";
import type { Attachment, Task, TaskRelationSummary } from "../types";
import { STATUS_DETAILS } from "./BoardColumn";
import {
  createInlineMediaSegmentsFromHtml,
  writeInlineMediaClipboard,
} from "./InlineMediaComposer";
import { MarkdownDocument } from "./MarkdownDocument";
import { LinearIcon } from "./LinearIcon";
import { StatusIcon } from "./SemanticIcons";

function referencedTask(
  href: string,
  referenceTasks: Task[],
): { identifier: string; task: Task | null } | null {
  try {
    const base = new URL(document.baseURI);
    base.search = "";
    base.hash = "";
    const url = new URL(href, base);
    if (url.origin !== base.origin || url.pathname !== base.pathname) return null;
    const identifier = readIssueIdentifier(url.search);
    const projectId = url.searchParams.get("project");
    if (!identifier || !projectId) return null;
    const task = referenceTasks.find((candidate) => (
      candidate.projectId === projectId && candidate.identifier === identifier
    )) ?? null;
    return { identifier: task?.externalKey ?? identifier, task };
  } catch {
    return null;
  }
}

function referencedAttachment(href: string, attachments: Attachment[]): Attachment | null {
  const match = new URL(href, document.baseURI).pathname.match(/\/api\/attachments\/([^/]+)\/download$/);
  if (!match) return null;
  const id = decodeURIComponent(match[1]);
  return attachments.find((attachment) => attachment.id === id) ?? null;
}

function fileSize(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function DescriptionDocument({
  value,
  referenceTasks,
  onOpenTask,
  attachments = [],
  onOpenAttachment,
}: {
  value: string;
  referenceTasks: Task[];
  onOpenTask: (task: TaskRelationSummary) => void;
  attachments?: Attachment[];
  onOpenAttachment?: (event: MouseEvent<HTMLAnchorElement>, attachment: Attachment) => void;
}) {
  return (
    <MarkdownDocument
      value={value}
      onCopy={(event: ClipboardEvent<HTMLDivElement>) => {
        const selection = event.currentTarget.ownerDocument.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
        const range = selection.getRangeAt(0);
        if (
          !event.currentTarget.contains(range.startContainer)
          || !event.currentTarget.contains(range.endContainer)
        ) return;
        const selectedRange = range.cloneRange();
        const wrapper = event.currentTarget.ownerDocument.createElement("div");
        wrapper.append(selectedRange.cloneContents());
        const segments = createInlineMediaSegmentsFromHtml(wrapper.innerHTML, referenceTasks);
        if (!segments) return;
        event.preventDefault();
        writeInlineMediaClipboard(
          event.clipboardData,
          segments,
        );
      }}
      renderLink={(href) => {
        const attachment = href ? referencedAttachment(href, attachments) : null;
        if (attachment) {
          if (attachment.contentType.startsWith("video/")) {
            return (
              <video
                className="document-inline-video"
                src={attachmentContentUrl(attachment)}
                aria-label={attachment.filename}
                controls
              />
            );
          }
          return (
            <span className="document-attachment-card">
              <span className="attachment-file-icon composer-attachment-file-icon" aria-hidden="true">
                <LinearIcon name="file" />
              </span>
              <span className="attachment-copy composer-attachment-copy">
                <strong>{attachment.filename}</strong>
                <span>{fileSize(attachment.size)}</span>
              </span>
            </span>
          );
        }
        const reference = href ? referencedTask(href, referenceTasks) : null;
        if (!reference) return null;
        const { task } = reference;
        if (!task) {
          return (
            <span className="issue-reference-inline">
              <span className="issue-reference-identity">
                <span className="issue-reference-id">{reference.identifier}</span>
              </span>
            </span>
          );
        }
        return (
          <span className={`issue-reference-inline issue-reference-status-${task.status}`}>
            <span className="issue-reference-identity">
              <span className={`status-icon issue-reference-status status-icon-${STATUS_DETAILS[task.status].tone}`}>
                <StatusIcon status={task.status} color="var(--column-status-color)" size={15} />
              </span>
              <span className="issue-reference-id">{task.externalKey ?? task.identifier}</span>
            </span>
            <span className="issue-reference-title">{task.title}</span>
          </span>
        );
      }}
      onLinkClick={(event, href) => {
        const attachment = href ? referencedAttachment(href, attachments) : null;
        if (attachment && onOpenAttachment) {
          if (
            event.button === 0
            && !event.metaKey
            && !event.ctrlKey
            && !event.shiftKey
            && !event.altKey
          ) onOpenAttachment(event, attachment);
          return;
        }
        const reference = href ? referencedTask(href, referenceTasks) : null;
        if (
          !reference
          || event.button !== 0
          || event.metaKey
          || event.ctrlKey
          || event.shiftKey
          || event.altKey
        ) return;
        event.preventDefault();
        if (reference.task) onOpenTask(reference.task);
      }}
    />
  );
}
