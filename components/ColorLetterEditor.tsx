"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { textSegments } from "@/lib/rich-text";
import { colorTypedText } from "@/lib/editor-colors";
import type { DiaryTextMark } from "@/lib/types";

const INPUT_COLORS = [
  { name: "默认", value: null, swatch: "#51443e" },
  { name: "粉色", value: "#d96f92", swatch: "#d96f92" },
  { name: "蓝色", value: "#6686ad", swatch: "#6686ad" },
] as const;

interface Props {
  content: string;
  marks?: DiaryTextMark[];
  onChange: (content: string, marks: DiaryTextMark[]) => void;
}

export default function ColorLetterEditor({ content, marks, onChange }: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const beforeSelection = useRef<{ start: number; end: number } | undefined>(undefined);
  const [ink, setInk] = useState<string | null>(null);
  const syncMirror = () => {
    const input = inputRef.current;
    const mirror = mirrorRef.current;
    if (!input || !mirror) return;
    mirror.style.width = `${input.clientWidth}px`;
    mirror.style.height = `${input.clientHeight}px`;
    mirror.scrollTop = input.scrollTop;
    mirror.scrollLeft = input.scrollLeft;
  };
  useLayoutEffect(syncMirror, [content, marks]);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const capture = () => { beforeSelection.current = { start: input.selectionStart, end: input.selectionEnd }; };
    input.addEventListener("beforeinput", capture);
    const observer = new ResizeObserver(syncMirror);
    observer.observe(input);
    return () => {
      input.removeEventListener("beforeinput", capture);
      observer.disconnect();
    };
  }, []);
  const chooseInk = (color: string | null) => {
    setInk(color);
    // Switching pens never recolors existing text or moves the caret.
    inputRef.current?.focus({ preventScroll: true });
  };
  return <div className="color-letter-editor">
    <div className="letter-color-caption">
      <span>输入颜色</span>
      <div className="typing-ink-buttons" role="group" aria-label="输入文字颜色">
        {INPUT_COLORS.map((color) => <button key={color.name} type="button"
          aria-label={`切换为${color.name}输入`} aria-pressed={ink === color.value}
          style={{ "--ink-swatch": color.swatch } as CSSProperties}
          onPointerDown={(event) => event.preventDefault()} onClick={() => chooseInk(color.value)}>
          <i aria-hidden="true">{ink === color.value ? "✓" : ""}</i>
        </button>)}
      </div>
    </div>
    <div className="color-letter-surface">
      <div ref={mirrorRef} className="letter-color-mirror" aria-hidden="true">
        {textSegments(content, marks).map((segment, index) => <span key={index} style={segment.color ? { color: segment.color } : undefined}>{segment.text}</span>)}{"\u200b"}
      </div>
      <textarea ref={inputRef} className="letter-textarea live-color-input" value={content}
        style={{ caretColor: ink ?? "#51443e" }}
        onChange={(event) => {
          const next = event.target.value;
          const nextMarks = colorTypedText(content, next, marks, ink, event.target.selectionStart, beforeSelection.current);
          beforeSelection.current = undefined;
          onChange(next, nextMarks);
        }} onScroll={syncMirror}
        spellCheck={false} placeholder="今天，想对你说……" aria-label="日记正文" />
    </div>
    <p className="letter-color-footnote">点颜色后继续写 · 只改变新输入的文字</p>
  </div>;
}
