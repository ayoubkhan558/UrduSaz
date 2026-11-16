import { rangeInEditor, selectedParagraphs } from "./paragraphs";

export type TypographyProperty = "font-family" | "font-size" | "line-height" | "letter-spacing";
export interface TypographyTarget { host: HTMLElement; range: Range }

export function applyTypography(target: TypographyTarget, property: TypographyProperty, value: string): boolean {
  const { host, range } = target;
  if (!host.isConnected || !rangeInEditor(host, range)) return false;
  const selection = window.getSelection();
  if (!selection) return false;

  if (range.collapsed || property === "line-height") {
    const element = range.startContainer instanceof Element
      ? range.startContainer : range.startContainer.parentElement;
    const cell = element?.closest<HTMLElement>("td,th");
    const blocks = selectedParagraphs(host, range).filter(block =>
      !range.collapsed || block.contains(range.startContainer)
    );
    if (!blocks.length && cell && host.contains(cell)) blocks.push(cell);
    if (!blocks.length) return false;
    blocks.forEach(block => setTypography(block, property, value));
  } else {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const pieces: { node: Text; start: number; end: number }[] = [];
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (!range.intersectsNode(node)) continue;
      const start = range.startContainer === node ? range.startOffset : 0;
      const end = range.endContainer === node ? range.endOffset : node.length;
      if (start < end) pieces.push({ node, start, end });
    }
    if (!pieces.length) return false;
    const runs = pieces.map(({ node, start, end }) => {
      const parent = node.parentElement;
      if (start === 0 && end === node.length && parent?.tagName === "SPAN" && parent.childNodes.length === 1) {
        setTypography(parent, property, value);
        return node;
      }
      if (end < node.length) node.splitText(end);
      const selected = start ? node.splitText(start) : node;
      const span = document.createElement("span");
      setTypography(span, property, value);
      selected.replaceWith(span);
      span.append(selected);
      return selected;
    });
    range.setStart(runs[0], 0);
    const last = runs[runs.length - 1];
    range.setEnd(last, last.length);
  }

  host.focus();
  selection.removeAllRanges();
  selection.addRange(range);
  host.dispatchEvent(new Event("harfsaz-format"));
  return true;
}

function setTypography(element: HTMLElement, property: TypographyProperty, value: string): void {
  element.dataset.harfsazTypography = "";
  element.style.setProperty(property, value);
}
