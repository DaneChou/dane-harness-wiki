import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type KeyboardEventHandler,
} from "react";
import { definitions } from "mdast-util-definitions";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { Attachment, Task } from "../types";
import { attachmentContentUrl, resolvePersistedAttachmentUrl } from "../api";
import { useTaskboardI18n } from "../i18n";
import { readIssueIdentifier } from "../issueRoute";
import { ColumnStatusIcon, STATUS_DETAILS } from "./BoardColumn";
import { clipboardImages, fileKey, MAX_ATTACHMENT_SIZE } from "./PendingAttachments";
import { LinearIcon } from "./LinearIcon";
import { IssueMentionMenu } from "./IssueMentionMenu";

interface InlineTextSegment {
  id: string;
  type: "text";
  text: string;
}

interface InlineImageSegment {
  id: string;
  type: "pending-image";
  token: string;
  file: File;
}

interface PersistedImageSegment {
  id: string;
  type: "persisted-image";
  markdown: string;
  alt: string;
  url: string;
}

interface IssueReferenceSegment {
  id: string;
  type: "issue-reference";
  markdown: string;
  identifier: string;
  taskId: string | null;
}

interface MarkdownAstNode {
  type: string;
  position: {
    start: { offset: number };
    end: { offset: number };
  };
  children?: MarkdownAstNode[];
  alt?: string | null;
  identifier?: string;
  url?: string;
}

export type InlineMediaSegment =
  | InlineTextSegment
  | InlineImageSegment
  | PersistedImageSegment
  | IssueReferenceSegment;
export type PendingInlineImage = InlineImageSegment;
type InlineMediaError = string | readonly [string, string];

export interface InlineMediaComposerHandle {
  focus: () => void;
  addImages: (files: FileList | File[]) => void;
}

interface InlineMediaComposerProps {
  segments: InlineMediaSegment[];
  mentionTasks?: readonly Task[];
  referenceTasks: readonly Task[];
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  onChange: (segments: InlineMediaSegment[]) => void;
  onError: (message: InlineMediaError | null) => void;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}

interface IssueMention {
  segmentId: string;
  start: number;
  end: number;
  query: string;
  anchor: HTMLTextAreaElement;
}

let segmentSequence = 0;
const inlineMediaMarkdownParser = unified().use(remarkParse).use(remarkGfm);
const EMPTY_MENTION_TASKS: readonly Task[] = [];

function segmentId(prefix: string): string {
  segmentSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${segmentSequence.toString(36)}`;
}

function textSegment(text = ""): InlineTextSegment {
  return { id: segmentId("text"), type: "text", text };
}

function imageSegment(file: File): InlineImageSegment {
  const id = segmentId("image");
  return {
    id,
    type: "pending-image",
    token: `<!--taskboard-inline-image:${id}-->`,
    file,
  };
}

export function createInlineMediaSegments(
  text = "",
  referenceTasks: readonly Task[] = EMPTY_MENTION_TASKS,
): InlineMediaSegment[] {
  const segments: InlineMediaSegment[] = [];
  const items: Array<
    | { type: "persisted-image"; start: number; end: number; alt: string; url: string }
    | {
        type: "issue-reference";
        start: number;
        end: number;
        identifier: string;
        taskId: string | null;
      }
  > = [];
  const root = inlineMediaMarkdownParser.parse(text);
  const getDefinition = definitions(root);
  const nodes = [root as MarkdownAstNode];

  while (nodes.length > 0) {
    const node = nodes.pop()!;
    if (node.type === "image") {
      items.push({
        type: "persisted-image",
        start: node.position.start.offset,
        end: node.position.end.offset,
        alt: node.alt ?? "",
        url: node.url!,
      });
    }
    if (node.type === "imageReference") {
      const definition = getDefinition(node.identifier);
      if (definition) {
        items.push({
          type: "persisted-image",
          start: node.position.start.offset,
          end: node.position.end.offset,
          alt: node.alt ?? "",
          url: definition.url,
        });
      }
    }
    if (node.type === "link" && node.url?.startsWith("?")) {
      const projectId = new URLSearchParams(node.url).get("project");
      const identifier = readIssueIdentifier(node.url);
      const task = projectId && identifier
        ? referenceTasks.find((candidate) => (
            candidate.projectId === projectId && candidate.identifier === identifier
          ))
        : null;
      if (projectId && identifier) {
        items.push({
          type: "issue-reference",
          start: node.position.start.offset,
          end: node.position.end.offset,
          identifier: task?.externalKey ?? identifier,
          taskId: task?.id ?? null,
        });
      }
    }
    if (node.children) nodes.push(...node.children);
  }

  items.sort((a, b) => a.start - b.start);
  let offset = 0;

  for (const item of items) {
    if (item.start > offset) segments.push(textSegment(text.slice(offset, item.start)));
    if (item.type === "persisted-image") {
      segments.push({
        id: segmentId("image"),
        type: "persisted-image",
        markdown: text.slice(item.start, item.end),
        alt: item.alt,
        url: item.url,
      });
    } else {
      segments.push({
        id: segmentId("issue"),
        type: "issue-reference",
        markdown: text.slice(item.start, item.end),
        identifier: item.identifier,
        taskId: item.taskId,
      });
    }
    offset = item.end;
  }

  if (offset < text.length) segments.push(textSegment(text.slice(offset)));
  return normalizeSegments(segments);
}

export function inlineMediaImages(segments: InlineMediaSegment[]): PendingInlineImage[] {
  return segments.filter((segment): segment is PendingInlineImage => segment.type === "pending-image");
}

export function inlineMediaText(segments: InlineMediaSegment[]): string {
  return segments.map((segment) => {
    if (segment.type === "text") return segment.text;
    if (segment.type === "pending-image") return "";
    return segment.markdown;
  }).join("");
}

export function serializeInlineMedia(segments: InlineMediaSegment[]): string {
  return segments.map((segment) => {
    if (segment.type === "text") return segment.text;
    if (segment.type === "pending-image") return `\n\n${segment.token}\n\n`;
    return segment.markdown;
  }).join("");
}

export function resolveInlineMediaMarkdown(
  value: string,
  images: PendingInlineImage[],
  attachments: Attachment[],
): string {
  return images.reduce((markdown, image, index) => {
    const attachment = attachments[index];
    if (!attachment) return markdown;
    const alt = image.file.name.replace(/[\\[\]]/g, "\\$&");
    return markdown.replace(
      image.token,
      `![${alt}](${attachmentContentUrl(attachment)})`,
    );
  }, value);
}

function normalizeSegments(segments: InlineMediaSegment[]): InlineMediaSegment[] {
  const normalized: InlineMediaSegment[] = [];
  for (const segment of segments) {
    const previous = normalized.at(-1);
    if (
      (segment.type === "issue-reference" && previous?.type !== "text")
      || (previous?.type === "issue-reference" && segment.type !== "text")
    ) {
      normalized.push(textSegment());
    }
    const adjacent = normalized.at(-1);
    if (segment.type === "text" && adjacent?.type === "text") {
      normalized[normalized.length - 1] = {
        ...adjacent,
        text: adjacent.text + segment.text,
      };
    } else {
      normalized.push(segment);
    }
  }
  if (normalized.length === 0) return [textSegment()];
  if (normalized[0].type !== "text") normalized.unshift(textSegment());
  if (normalized.at(-1)?.type !== "text") normalized.push(textSegment());
  return normalized;
}

function resizeTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "0px";
  element.style.height = `${element.scrollHeight}px`;
}

function PendingImageBlock({
  segment,
  disabled,
  onRemove,
}: {
  segment: PendingInlineImage;
  disabled: boolean;
  onRemove: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState("");
  const { text } = useTaskboardI18n();

  useLayoutEffect(() => {
    const url = URL.createObjectURL(segment.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [segment.file]);

  return (
    <figure className="inline-media-image">
      {previewUrl && <img src={previewUrl} alt={segment.file.name} />}
      <button
        type="button"
        disabled={disabled}
        aria-label={text(`移除 ${segment.file.name}`, `Remove ${segment.file.name}`)}
        onClick={onRemove}
      >
        <LinearIcon name="close" />
      </button>
    </figure>
  );
}

function PersistedImageBlock({
  segment,
  disabled,
  onRemove,
}: {
  segment: PersistedImageSegment;
  disabled: boolean;
  onRemove: () => void;
}) {
  const { text } = useTaskboardI18n();

  return (
    <figure className="inline-media-image">
      <img src={resolvePersistedAttachmentUrl(segment.url)} alt={segment.alt} />
      <button
        type="button"
        disabled={disabled}
        aria-label={text(`移除 ${segment.alt || "图片"}`, `Remove ${segment.alt || "image"}`)}
        onClick={onRemove}
      >
        <LinearIcon name="close" />
      </button>
    </figure>
  );
}

function IssueReferenceChip({
  segment,
  task,
  disabled,
  onRemove,
}: {
  segment: IssueReferenceSegment;
  task: Task | null;
  disabled: boolean;
  onRemove: () => void;
}) {
  const { text } = useTaskboardI18n();
  const displayIdentifier = task?.externalKey ?? segment.identifier;

  return (
    <button
      type="button"
      className={`issue-reference-inline inline-media-issue-reference${task ? ` issue-reference-status-${task.status}` : ""}`}
      disabled={disabled}
      aria-label={task
        ? text(
            `${displayIdentifier} ${task.title}，按退格键或删除键移除`,
            `${displayIdentifier} ${task.title}, press Backspace or Delete to remove`,
          )
        : text(
            `${displayIdentifier}，按退格键或删除键移除`,
            `${displayIdentifier}, press Backspace or Delete to remove`,
          )}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if (event.key !== "Backspace" && event.key !== "Delete") return;
        event.preventDefault();
        onRemove();
      }}
    >
      {task && (
        <span className={`status-icon issue-reference-status status-icon-${STATUS_DETAILS[task.status].tone}`}>
          <ColumnStatusIcon status={task.status === "backlog" ? "todo" : task.status} />
        </span>
      )}
      <span className="issue-reference-id">{displayIdentifier}</span>
      {task && <span className="issue-reference-title">{task.title}</span>}
    </button>
  );
}

export const InlineMediaComposer = forwardRef<InlineMediaComposerHandle, InlineMediaComposerProps>(
  function InlineMediaComposer({
    segments,
    mentionTasks = EMPTY_MENTION_TASKS,
    referenceTasks,
    placeholder,
    ariaLabel,
    disabled = false,
    className = "",
    onChange,
    onError,
    onKeyDown,
  }, ref) {
    const rootRef = useRef<HTMLDivElement>(null);
    const textareas = useRef(new Map<string, HTMLTextAreaElement>());
    const pendingFocus = useRef<{ id: string; offset: number } | null>(null);
    const { text } = useTaskboardI18n();
    const [mention, setMention] = useState<IssueMention | null>(null);
    const [activeMentionIndex, setActiveMentionIndex] = useState(0);
    const [allSelected, setAllSelected] = useState(false);
    const mentionResults = useMemo(() => {
      if (!mention) return [];
      const query = mention.query.toLocaleLowerCase();
      return mentionTasks.filter((task) => (
        !query
        || (task.externalKey ?? task.identifier).toLocaleLowerCase().includes(query)
        || task.title.toLocaleLowerCase().includes(query)
      ));
    }, [mention, mentionTasks]);
    const selectedMentionIndex = Math.min(
      activeMentionIndex,
      Math.max(mentionResults.length - 1, 0),
    );

    useLayoutEffect(() => {
      for (const element of textareas.current.values()) resizeTextarea(element);
      const focus = pendingFocus.current;
      if (!focus) return;
      const target = textareas.current.get(focus.id);
      if (!target) return;
      target.focus();
      target.setSelectionRange(focus.offset, focus.offset);
      pendingFocus.current = null;
    }, [segments]);

    useEffect(() => {
      setActiveMentionIndex(0);
    }, [mention?.query]);

    useEffect(() => {
      if (disabled || mentionTasks.length === 0) setMention(null);
    }, [disabled, mentionTasks.length]);

    useEffect(() => {
      if (!allSelected) return;
      const exitAllSelection = () => setAllSelected(false);
      document.addEventListener("pointerdown", exitAllSelection, true);
      return () => document.removeEventListener("pointerdown", exitAllSelection, true);
    }, [allSelected]);

    useImperativeHandle(ref, () => ({
      focus() {
        const firstText = segments.find((segment) => segment.type === "text");
        if (firstText) textareas.current.get(firstText.id)?.focus();
      },
      addImages(files) {
        const selected = Array.from(files).filter((file) => file.type.startsWith("image/"));
        if (selected.length === 0) return;

        const oversized = selected.find((file) => file.size > MAX_ATTACHMENT_SIZE);
        if (oversized) {
          onError([
            `“${oversized.name}” 超过 25 MB，无法上传。`,
            `“${oversized.name}” is larger than 25 MB and cannot be uploaded.`,
          ]);
          return;
        }

        const existing = new Set(inlineMediaImages(segments).map((image) => fileKey(image.file)));
        const images = selected.filter((file) => {
          const key = fileKey(file);
          if (existing.has(key)) return false;
          existing.add(key);
          return true;
        });
        if (images.length === 0) return;
        onError(null);
        onChange(normalizeSegments([...segments, ...images.map(imageSegment)]));
      },
    }), [onChange, onError, segments]);

    function changeText(id: string, text: string) {
      if (allSelected) {
        setAllSelected(false);
        onChange([{ id, type: "text", text }]);
        return;
      }
      onChange(segments.map((segment) => (
        segment.id === id && segment.type === "text" ? { ...segment, text } : segment
      )));
    }

    function clearAll() {
      const empty = textSegment();
      pendingFocus.current = { id: empty.id, offset: 0 };
      setAllSelected(false);
      setMention(null);
      onChange([empty]);
    }

    function removeIssueReference(id: string) {
      const index = segments.findIndex((segment) => segment.id === id);
      if (index < 0) return;
      const previous = segments[index - 1];
      const next = segments[index + 1];
      const nextSegments = normalizeSegments(segments.filter((segment) => segment.id !== id));
      const focusId = previous?.type === "text"
        ? previous.id
        : next?.type === "text"
          ? next.id
          : null;
      if (focusId) {
        pendingFocus.current = {
          id: focusId,
          offset: previous?.type === "text" ? previous.text.length : 0,
        };
      }
      setMention(null);
      onChange(nextSegments);
    }

    function updateMention(
      segment: InlineTextSegment,
      value: string,
      textarea: HTMLTextAreaElement,
    ) {
      if (mentionTasks.length === 0 || textarea.selectionStart !== textarea.selectionEnd) {
        setMention(null);
        return;
      }
      const end = textarea.selectionStart;
      const prefix = value.slice(0, end);
      const match = /(?:^|\s)@([^\s@]*)$/.exec(prefix);
      if (!match) {
        setMention(null);
        return;
      }
      setMention({
        segmentId: segment.id,
        start: prefix.lastIndexOf("@"),
        end,
        query: match[1],
        anchor: textarea,
      });
    }

    function selectMention(task: Task) {
      if (!mention) return;
      const segment = segments.find((candidate): candidate is InlineTextSegment => (
        candidate.id === mention.segmentId && candidate.type === "text"
      ));
      if (!segment) return;
      const displayIdentifier = task.externalKey ?? task.identifier;
      const route = new URLSearchParams({ project: task.projectId, issue: task.identifier });
      const suffix = segment.text.slice(mention.end);
      const insertSpace = !/^\s/.test(suffix);
      const before = { ...segment, text: segment.text.slice(0, mention.start) };
      const reference: IssueReferenceSegment = {
        id: segmentId("issue"),
        type: "issue-reference",
        markdown: `[@${displayIdentifier}](?${route})`,
        identifier: displayIdentifier,
        taskId: task.id,
      };
      const after = textSegment(`${insertSpace ? " " : ""}${suffix}`);
      pendingFocus.current = { id: after.id, offset: insertSpace ? 1 : 0 };
      setMention(null);
      onChange(normalizeSegments(segments.flatMap((candidate) => (
        candidate.id === segment.id ? [before, reference, after] : [candidate]
      ))));
    }

    function handleTextareaKeyDown(
      event: KeyboardEvent<HTMLTextAreaElement>,
      segment: InlineTextSegment,
      index: number,
    ) {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (
        event.key === "Backspace"
        && event.currentTarget.selectionStart === 0
        && event.currentTarget.selectionEnd === 0
        && segments[index - 1]?.type === "issue-reference"
      ) {
        event.preventDefault();
        removeIssueReference(segments[index - 1].id);
        return;
      }
      if (
        event.key === "Delete"
        && event.currentTarget.selectionStart === segment.text.length
        && event.currentTarget.selectionEnd === segment.text.length
        && segments[index + 1]?.type === "issue-reference"
      ) {
        event.preventDefault();
        removeIssueReference(segments[index + 1].id);
        return;
      }
    }

    function selectNearestTextSegment(target: EventTarget | null) {
      const root = rootRef.current;
      if (!root || !(target instanceof Element)) return;
      let segmentElement = target;
      while (segmentElement.parentElement && segmentElement.parentElement !== root) {
        segmentElement = segmentElement.parentElement;
      }
      const childIndex = segmentElement.parentElement === root
        ? Array.from(root.children).indexOf(segmentElement)
        : 0;
      const origin = Math.min(Math.max(childIndex, 0), segments.length - 1);
      for (let distance = 0; distance < segments.length; distance += 1) {
        const indexes = distance === 0 ? [origin] : [origin - distance, origin + distance];
        for (const index of indexes) {
          const candidate = segments[index];
          if (candidate?.type !== "text") continue;
          const textarea = textareas.current.get(candidate.id);
          if (!textarea) continue;
          textarea.focus();
          textarea.setSelectionRange(0, candidate.text.length);
          return;
        }
      }
    }

    function handleComposerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      if (event.nativeEvent.isComposing || event.keyCode === 229) {
        onKeyDown?.(event);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "a") {
        event.preventDefault();
        selectNearestTextSegment(event.target);
        setAllSelected(true);
        setMention(null);
        return;
      }
      if (allSelected && (event.key === "Backspace" || event.key === "Delete")) {
        event.preventDefault();
        clearAll();
        return;
      }
      if (
        allSelected
        && [
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End",
          "PageUp",
          "PageDown",
        ].includes(event.key)
      ) {
        setAllSelected(false);
      }
      if (mention && event.key === "ArrowDown" && mentionResults.length > 0) {
        event.preventDefault();
        setActiveMentionIndex((index) => (index + 1) % mentionResults.length);
        return;
      }
      if (mention && event.key === "ArrowUp" && mentionResults.length > 0) {
        event.preventDefault();
        setActiveMentionIndex((index) => (index - 1 + mentionResults.length) % mentionResults.length);
        return;
      }
      if (mention && event.key === "Enter" && mentionResults[selectedMentionIndex]) {
        event.preventDefault();
        selectMention(mentionResults[selectedMentionIndex]);
        return;
      }
      if (mention && event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return;
      }
      onKeyDown?.(event);
    }

    function pasteContent(
      event: ClipboardEvent<HTMLTextAreaElement>,
      segment: InlineTextSegment,
    ) {
      const clipboardFiles = clipboardImages(event.clipboardData);
      if (clipboardFiles.length > 0) {
        event.preventDefault();

        const oversized = clipboardFiles.find((file) => file.size > MAX_ATTACHMENT_SIZE);
        if (oversized) {
          onError([
            `“${oversized.name}” 超过 25 MB，无法上传。`,
            `“${oversized.name}” is larger than 25 MB and cannot be uploaded.`,
          ]);
          return;
        }

        const existing = new Set(inlineMediaImages(segments).map((image) => fileKey(image.file)));
        const images = clipboardFiles.filter((file) => {
          const key = fileKey(file);
          if (existing.has(key)) return false;
          existing.add(key);
          return true;
        });
        if (images.length === 0) return;
        onError(null);

        const textarea = event.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const before = { ...segment, text: segment.text.slice(0, start) };
        const after = textSegment(segment.text.slice(end));
        const insertion = images.map(imageSegment);
        const next = segments.flatMap((candidate) => (
          candidate.id === segment.id ? [before, ...insertion, after] : [candidate]
        ));
        pendingFocus.current = { id: after.id, offset: 0 };
        setAllSelected(false);
        onChange(next);
        return;
      }

      const pastedText = event.clipboardData.getData("text/plain");
      const insertion = createInlineMediaSegments(pastedText, referenceTasks);
      if (!insertion.some((candidate) => candidate.type !== "text")) return;
      event.preventDefault();

      const textarea = event.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      if (allSelected) {
        const finalText = insertion.at(-1) as InlineTextSegment;
        pendingFocus.current = { id: finalText.id, offset: finalText.text.length };
        setAllSelected(false);
        setMention(null);
        onChange(insertion);
        return;
      }

      const firstText = insertion[0] as InlineTextSegment;
      const finalText = insertion.at(-1) as InlineTextSegment;
      const focusOffset = finalText.text.length;
      insertion[0] = {
        ...segment,
        text: segment.text.slice(0, start) + firstText.text,
      };
      insertion[insertion.length - 1] = {
        ...finalText,
        text: finalText.text + segment.text.slice(end),
      };
      pendingFocus.current = { id: finalText.id, offset: focusOffset };
      setMention(null);
      onChange(segments.flatMap((candidate) => (
        candidate.id === segment.id ? insertion : [candidate]
      )));
    }

    function removeImage(id: string) {
      onChange(normalizeSegments(segments.filter((segment) => segment.id !== id)));
    }

    const isEmpty = segments.every((segment) => (
      segment.type === "text" ? segment.text.length === 0 : false
    ));
    const hasIssueReferences = segments.some((segment) => segment.type === "issue-reference");

    return (
      <div
        ref={rootRef}
        className={`inline-media-composer${hasIssueReferences ? " has-issue-references" : ""}${allSelected ? " is-all-selected" : ""} ${className}`.trim()}
        aria-label={ariaLabel}
        onKeyDownCapture={handleComposerKeyDown}
        onCopy={(event) => {
          if (!allSelected) return;
          event.preventDefault();
          event.clipboardData.setData("text/plain", serializeInlineMedia(segments));
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setAllSelected(false);
          }
        }}
      >
        {segments.map((segment, index) => (
          segment.type === "text" ? (
            <textarea
              key={segment.id}
              ref={(element) => {
                if (element) textareas.current.set(segment.id, element);
                else textareas.current.delete(segment.id);
              }}
              value={segment.text}
              rows={1}
              disabled={disabled}
              aria-label={index === 0 ? ariaLabel : text(`${ariaLabel}续写`, `${ariaLabel} continuation`)}
              placeholder={isEmpty && index === 0 ? placeholder : undefined}
              onChange={(event) => {
                changeText(segment.id, event.target.value);
                resizeTextarea(event.currentTarget);
                updateMention(segment, event.target.value, event.currentTarget);
              }}
              onPaste={(event) => pasteContent(event, segment)}
              onKeyDown={(event) => handleTextareaKeyDown(event, segment, index)}
              onKeyUp={(event) => {
                if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                  updateMention(segment, event.currentTarget.value, event.currentTarget);
                }
              }}
              onClick={(event) => updateMention(segment, event.currentTarget.value, event.currentTarget)}
              onBlur={() => setMention(null)}
            />
          ) : segment.type === "pending-image" ? (
            <PendingImageBlock
              key={segment.id}
              segment={segment}
              disabled={disabled}
              onRemove={() => removeImage(segment.id)}
            />
          ) : segment.type === "persisted-image" ? (
            <PersistedImageBlock
              key={segment.id}
              segment={segment}
              disabled={disabled}
              onRemove={() => removeImage(segment.id)}
            />
          ) : (
            <IssueReferenceChip
              key={segment.id}
              segment={segment}
              task={segment.taskId
                ? referenceTasks.find((task) => task.id === segment.taskId) ?? null
                : null}
              disabled={disabled}
              onRemove={() => removeIssueReference(segment.id)}
            />
          )
        ))}
        {mention && (
          <IssueMentionMenu
            anchor={mention.anchor}
            anchorOffset={mention.start}
            tasks={mentionResults}
            activeIndex={selectedMentionIndex}
            onActiveIndexChange={setActiveMentionIndex}
            onSelect={selectMention}
            onClose={() => setMention(null)}
          />
        )}
      </div>
    );
  },
);
