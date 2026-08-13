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
}

const RAW_COMMENT = /<!--[\s\S]*?-->/g;
const ENCODED_COMMENT = /&lt;!--[\s\S]*?--&gt;/gi;
const MERMAID_IMAGE_PROPERTY = /\bimg\s*:/i;
const EXTERNAL_CSS_REFERENCE = /@import|url\s*\(\s*(?!(?:['"]\s*)?#)/i;

export function remarkStripMarkdownComments() {
  return (tree: MarkdownAstNode) => {
    const visit = (node: MarkdownAstNode) => {
      if (!node.children) return;
      node.children = node.children.filter((child) => {
        if (child.type === "html" && child.value) {
          child.value = child.value.replace(RAW_COMMENT, "");
          return child.value.trim().length > 0;
        }
        if (child.type === "text" && child.value) {
          child.value = child.value.replace(ENCODED_COMMENT, "").replace(RAW_COMMENT, "");
        }
        visit(child);
        return true;
      });
    };
    visit(tree);
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
  const [theme, setTheme] = useState(() => (
    typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light"
  ));
  const [diagram, setDiagram] = useState<{ svg: string } | { error: true } | null>(null);

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
    void Promise.all([import("mermaid"), import("dompurify")])
      .then(async ([mermaidModule, purifierModule]) => {
        const mermaid = mermaidModule.default;
        if (EXTERNAL_CSS_REFERENCE.test(source)) {
          throw new Error("External Mermaid resources are not allowed.");
        }
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: theme === "dark" ? "dark" : "default",
          htmlLabels: false,
        });
        if (MERMAID_IMAGE_PROPERTY.test(source)) {
          const parsed = await mermaid.mermaidAPI.getDiagramFromText(source);
          const vertices = (
            parsed.db as { getVertices?: () => Map<string, { img?: string }> }
          ).getVertices?.();
          if ([...(vertices?.values() ?? [])].some((vertex) => vertex.img)) {
            throw new Error("External Mermaid resources are not allowed.");
          }
        }
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
        if (!cancelled) setDiagram({ svg: svgRoot.innerHTML });
      })
      .catch(() => {
        if (!cancelled) setDiagram({ error: true });
      });
    return () => { cancelled = true; };
  }, [renderId, source, theme]);

  if (!diagram) {
    return <div className="markdown-mermaid" aria-busy="true"><MermaidFallback source={source} /></div>;
  }
  if ("error" in diagram) {
    return <div className="markdown-mermaid"><MermaidFallback source={source} error /></div>;
  }
  return (
    <div
      className="markdown-mermaid"
      role="img"
      aria-label={text("Mermaid 图", "Mermaid diagram")}
      dangerouslySetInnerHTML={{ __html: diagram.svg }}
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
