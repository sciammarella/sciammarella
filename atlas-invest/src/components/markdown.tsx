// Minimal, safe Markdown renderer for agent reports (no HTML passthrough).
import { Fragment } from "react";

function inline(text: string, key: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|_[^_]+_|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) parts.push(<strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) parts.push(<code key={`${key}-${i++}`} className="rounded bg-muted px-1 text-[0.85em]">{t.slice(1, -1)}</code>);
    else parts.push(<em key={`${key}-${i++}`}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: number) => {
    if (list.length) {
      blocks.push(<ul key={`ul-${k}`} className="my-2 list-disc space-y-1 pl-5">{list.map((l, i) => <li key={i}>{inline(l, `li-${k}-${i}`)}</li>)}</ul>);
      list = [];
    }
  };
  lines.forEach((raw, k) => {
    const line = raw.trimEnd();
    if (/^\s*[-*] /.test(line)) {
      list.push(line.replace(/^\s*[-*] /, ""));
      return;
    }
    flush(k);
    if (!line.trim()) return;
    if (line.startsWith("### ")) blocks.push(<h4 key={k} className="mt-4 font-semibold">{inline(line.slice(4), `h-${k}`)}</h4>);
    else if (line.startsWith("## ")) blocks.push(<h3 key={k} className="mt-5 text-base font-semibold">{inline(line.slice(3), `h-${k}`)}</h3>);
    else if (line.startsWith("# ")) blocks.push(<h2 key={k} className="mt-5 text-lg font-semibold">{inline(line.slice(2), `h-${k}`)}</h2>);
    else if (line.startsWith("> ")) blocks.push(<blockquote key={k} className="my-2 border-l-2 border-attention pl-3 text-sm text-muted-foreground">{inline(line.slice(2), `q-${k}`)}</blockquote>);
    else blocks.push(<p key={k} className="my-2">{inline(line, `p-${k}`)}</p>);
  });
  flush(lines.length);
  return <div className="text-sm leading-relaxed">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
