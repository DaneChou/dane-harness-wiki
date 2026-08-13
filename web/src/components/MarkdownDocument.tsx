import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { resolvePersistedAttachmentUrl } from "../api";
import { useTaskboardI18n } from "../i18n";

interface MarkdownAstNode {
  type: string;
  value?: string;
  children?: MarkdownAstNode[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

const RAW_COMMENT = /<!--[\s\S]*?-->/g;
const EXTERNAL_CSS_REFERENCE = /@import|url\s*\(\s*(?!(?:['"]\s*)?#)/i;
const MERMAID_EXTERNAL_RESOURCE = /@\{[^}]*\b["']?img["']?\s*:\s*["']?\s*(?:https?:)?\/\/|\bproperties\s+[^:\r\n]+\s*:\s*\{[^}]*["']?icon["']?\s*:\s*["']?\s*(?:https?:)?\/\/|^\s*(?:(?:Person(?:_Ext)?|System(?:Db|Queue)?(?:_Ext)?)\s*\((?:(?:"[^"\r\n]*"|[^,\r\n]*)\s*,){3}|(?:(?:Container|Component)(?:Db|Queue)?(?:_Ext)?|Deployment_Node|Node(?:_[LR])?)\s*\((?:(?:"[^"\r\n]*"|[^,\r\n]*)\s*,){4}|(?:Rel(?:_(?:Up|Down|Left|Right|Back|[UDLR]))?|BiRel)\s*\((?:(?:"[^"\r\n]*"|[^,\r\n]*)\s*,){5}|RelIndex\s*\((?:(?:"[^"\r\n]*"|[^,\r\n]*)\s*,){6}|UpdateElementStyle\s*\((?:(?:"[^"\r\n]*"|[^,\r\n]*)\s*,){6})\s*(?:\$sprite\s*=\s*)?["']?\s*(?:https?:)?\/\//im;

interface EncodedCommentMarker {
  kind: "open" | "close";
  node: MarkdownAstNode;
  sourceOffset: number;
  sourceEndOffset: number;
  valueOffset: number;
  valueEndOffset: number;
}

interface EncodedCommentRange {
  open: EncodedCommentMarker;
  close: EncodedCommentMarker;
}

function hasExternalMermaidCss(source: string) {
  const frontmatter = source.match(/^\s*---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (frontmatter) {
    const themeCssOffset = frontmatter[1].search(/["']?\bthemeCSS\b["']?\s*:/i);
    if (themeCssOffset >= 0 && EXTERNAL_CSS_REFERENCE.test(frontmatter[1].slice(themeCssOffset))) return true;
  }

  for (const directive of source.matchAll(/%%\{\s*(?:init|initialize)\s*:\s*([\s\S]*?)\}%%/gi)) {
    const themeCssOffset = directive[1].search(/["']?\bthemeCSS\b["']?\s*:/i);
    if (themeCssOffset >= 0 && EXTERNAL_CSS_REFERENCE.test(directive[1].slice(themeCssOffset))) return true;
  }

  return source.split(/\r?\n/).some((line) => (
    /^\s*(?:style\s+\S+|classDef\s+\S+|linkStyle\s+\S+|rect\b|UpdateElementStyle\s*\(|UpdateRelStyle\s*\()/i.test(line)
    && EXTERNAL_CSS_REFERENCE.test(line)
  ));
}

export function remarkStripMarkdownComments() {
  return (tree: MarkdownAstNode, file: { value?: unknown }) => {
    const source = String(file.value ?? "");
    const markers: EncodedCommentMarker[] = [];

    const collectMarkers = (node: MarkdownAstNode) => {
      if (node.type === "text" && node.value && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
        const sourceStart = node.position.start.offset;
        const sourceValue = source.slice(sourceStart, node.position.end.offset);
        const valueOpenMarkers = [...node.value.matchAll(/<!--/g)];
        const sourceOpenMarkers = [...sourceValue.matchAll(/&lt;!--|<!--/gi)].filter((match) => {
          if (!match[0].toLowerCase().startsWith("&lt;")) return true;
          let backslashes = 0;
          for (let index = (match.index ?? 0) - 1; index >= 0 && sourceValue[index] === "\\"; index -= 1) {
            backslashes += 1;
          }
          return backslashes % 2 === 0;
        });
        sourceOpenMarkers.forEach((match, index) => {
          if (!match[0].toLowerCase().startsWith("&lt;") || !valueOpenMarkers[index]) return;
          markers.push({
            kind: "open",
            node,
            sourceOffset: sourceStart + (match.index ?? 0),
            sourceEndOffset: sourceStart + (match.index ?? 0) + match[0].length,
            valueOffset: valueOpenMarkers[index].index,
            valueEndOffset: valueOpenMarkers[index].index + valueOpenMarkers[index][0].length,
          });
        });

        const valueCloseMarkers = [...node.value.matchAll(/-->/g)];
        const sourceCloseMarkers = [...sourceValue.matchAll(/--&gt;|-->/gi)];
        sourceCloseMarkers.forEach((match, index) => {
          if (!match[0].toLowerCase().endsWith("&gt;") || !valueCloseMarkers[index]) return;
          markers.push({
            kind: "close",
            node,
            sourceOffset: sourceStart + (match.index ?? 0),
            sourceEndOffset: sourceStart + (match.index ?? 0) + match[0].length,
            valueOffset: valueCloseMarkers[index].index,
            valueEndOffset: valueCloseMarkers[index].index + valueCloseMarkers[index][0].length,
          });
        });
      }
      node.children?.forEach(collectMarkers);
    };
    collectMarkers(tree);

    const ranges: EncodedCommentRange[] = [];
    let open: EncodedCommentMarker | null = null;
    markers.sort((left, right) => left.sourceOffset - right.sourceOffset).forEach((marker) => {
      if (marker.kind === "open") {
        if (!open) open = marker;
      } else if (open) {
        ranges.push({ open, close: marker });
        open = null;
      }
    });

    const fullyInsideRange = (node: MarkdownAstNode) => (
      node.position?.start.offset !== undefined
      && node.position.end.offset !== undefined
      && ranges.some((range) => (
        range.open.sourceOffset <= node.position!.start.offset!
        && node.position!.end.offset! <= range.close.sourceEndOffset
      ))
    );

    const visit = (node: MarkdownAstNode, root = false): boolean => {
      if (!root && fullyInsideRange(node)) return false;
      if (node.type === "html" && node.value) {
        node.value = node.value.replace(RAW_COMMENT, "");
        return node.value.trim().length > 0;
      }
      if (node.type === "text" && node.value && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
        const removals = ranges.flatMap((range) => {
          if (node.position!.end.offset! <= range.open.sourceOffset || range.close.sourceEndOffset <= node.position!.start.offset!) {
            return [];
          }
          return [{
            start: range.open.node === node ? range.open.valueOffset : 0,
            end: range.close.node === node ? range.close.valueEndOffset : node.value!.length,
          }];
        }).sort((left, right) => right.start - left.start);
        for (const removal of removals) {
          node.value = node.value.slice(0, removal.start) + node.value.slice(removal.end);
        }
        return node.value.length > 0;
      }
      if (node.children) {
        node.children = node.children.filter((child) => visit(child));
        if (!root && node.children.length === 0) return false;
      }
      return true;
    };
    visit(tree, true);
  };
}

function codeBlockLanguage(children: ReactNode): { language: string | null; source: string } {
  const code = Children.toArray(children).find(
    (child): child is ReactElement<{ className?: string; children?: ReactNode }> => (
      isValidElement(child) && child.type === "code"
    ),
  );
  const language = code?.props.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1]?.toLowerCase() ?? null;
  return { language, source: Children.toArray(code?.props.children).join("") };
}

function MermaidFallback({ source, error }: { source: string; error?: boolean }) {
  const { text } = useTaskboardI18n();
  return (
    <div className="markdown-mermaid-fallback" role={error ? "alert" : undefined}>
      {error && <p>{text(
        "无法渲染 Mermaid 图，下面显示图表源码。",
        "Unable to render Mermaid diagram. Showing its source instead.",
      )}</p>}
      <details open={error}>
        <summary>{text("Mermaid 源码", "Mermaid source")}</summary>
        <pre><code className="language-mermaid">{source}</code></pre>
      </details>
    </div>
  );
}

export function MermaidDiagram({ source }: { source: string }) {
  const { text } = useTaskboardI18n();
  const reactId = useId();
  const renderId = `taskboard-mermaid-${reactId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [theme, setTheme] = useState<"light" | "dark">(() => (
    typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light"
  ));
  const [diagram, setDiagram] = useState<(
    { source: string; theme: "light" | "dark" } & ({ svg: string } | { error: true })
  ) | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setTheme(root.dataset.theme === "dark" ? "dark" : "light");
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDiagram(null);
    if (MERMAID_EXTERNAL_RESOURCE.test(source) || hasExternalMermaidCss(source)) {
      setDiagram({ source, theme, error: true });
      return undefined;
    }
    void Promise.all([import("mermaid"), import("dompurify")])
      .then(async ([mermaidModule, purifierModule]) => {
        const mermaid = mermaidModule.default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: theme === "dark" ? "dark" : "default",
          htmlLabels: false,
        });
        const { svg } = await mermaid.render(renderId, source);
        const sanitizedSvg = purifierModule.default.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ["foreignObject", "image", "script"],
          FORBID_ATTR: ["href", "xlink:href"],
        });
        const svgRoot = document.createElement("template");
        svgRoot.innerHTML = sanitizedSvg;
        if (svgRoot.content.children.length !== 1 || svgRoot.content.firstElementChild?.localName !== "svg") {
          throw new Error("Mermaid did not produce a usable SVG document.");
        }
        svgRoot.content.querySelectorAll("style").forEach((element) => {
          if (EXTERNAL_CSS_REFERENCE.test(element.textContent ?? "")) element.remove();
        });
        svgRoot.content.querySelectorAll<SVGElement>("[style]").forEach((element) => {
          if (EXTERNAL_CSS_REFERENCE.test(element.getAttribute("style") ?? "")) {
            element.removeAttribute("style");
          }
        });
        if (!cancelled) setDiagram({ source, theme, svg: svgRoot.innerHTML });
      })
      .catch(() => {
        if (!cancelled) setDiagram({ source, theme, error: true });
      });
    return () => { cancelled = true; };
  }, [renderId, source, theme]);

  const currentDiagram = diagram?.source === source && diagram.theme === theme ? diagram : null;
  if (!currentDiagram) {
    return <div className="markdown-mermaid" aria-busy="true"><MermaidFallback source={source} /></div>;
  }
  if ("error" in currentDiagram) {
    return <div className="markdown-mermaid"><MermaidFallback source={source} error /></div>;
  }
  return (
    <div
      className="markdown-mermaid"
      role="img"
      aria-label={text("Mermaid 图", "Mermaid diagram")}
      dangerouslySetInnerHTML={{ __html: currentDiagram.svg }}
    />
  );
}

function MarkdownPre({ children, ...props }: ComponentPropsWithoutRef<"pre">) {
  const { language, source } = codeBlockLanguage(children);
  if (language === "mermaid") return <MermaidDiagram source={source} />;
  return <pre {...props}>{children}</pre>;
}

export function MarkdownDocument({ value }: { value: string }) {
  return (
    <div className="issue-description-document">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkStripMarkdownComments, remarkBreaks]}
        urlTransform={(url) => defaultUrlTransform(resolvePersistedAttachmentUrl(url))}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          pre: MarkdownPre,
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}
