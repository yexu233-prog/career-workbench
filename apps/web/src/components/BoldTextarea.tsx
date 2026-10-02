import { useRef, useState, type TextareaHTMLAttributes } from "react";
import { toggleBoldMarkup } from "@career-workbench/domain";

interface BoldTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
}

export function BoldTextarea({ value, onValueChange, ...textareaProps }: BoldTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const updateSelectionState = () => {
    const textarea = textareaRef.current;
    setHasSelection(Boolean(textarea && textarea.selectionEnd > textarea.selectionStart));
  };
  const toggleBold = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const result = toggleBoldMarkup(value, textarea.selectionStart, textarea.selectionEnd);
    if (result.value === value) return;
    onValueChange(result.value);
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
      updateSelectionState();
    });
  };
  return <div className="bold-textarea">
    <div className="bold-textarea-toolbar"><button type="button" disabled={!hasSelection} onMouseDown={(event) => event.preventDefault()} onClick={toggleBold} aria-label="加粗所选文字"><strong>B</strong> 加粗</button><span>先选择文字；编辑框显示 ** 标记，右侧预览显示粗体</span></div>
    <textarea ref={textareaRef} value={value} onChange={(event) => onValueChange(event.target.value)} onSelect={updateSelectionState} onKeyUp={updateSelectionState} onClick={updateSelectionState} {...textareaProps} />
  </div>;
}
