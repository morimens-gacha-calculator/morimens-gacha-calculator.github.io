import { useEffect, useRef, useState } from "react";

// A number field you can clear while typing. It reports a value only when the text
// is a valid number inside [min, max]; if you leave it empty or invalid, it falls back
// to `fallback` (default: min) when it loses focus.
export default function NumberInput({ value, onChange, min = 0, max = Infinity, fallback, integer = true, ...rest }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const editing = useRef(false);

  // Follow outside changes (presets, imports) when the person isn't typing here
  useEffect(() => {
    if (!editing.current) setText(value == null ? "" : String(value));
  }, [value]);

  const parse = (s) => {
    if (String(s).trim() === "") return null;
    const v = Number(s);
    if (!Number.isFinite(v)) return null;
    return integer ? Math.floor(v) : v;
  };

  return (
    <input
      type="number"
      inputMode={integer ? "numeric" : "decimal"}
      min={Number.isFinite(min) ? min : undefined}
      max={Number.isFinite(max) ? max : undefined}
      {...rest}
      value={text}
      onFocus={() => { editing.current = true; }}
      onChange={(e) => {
        setText(e.target.value);
        const v = parse(e.target.value);
        if (v != null && v >= min && v <= max && v !== value) onChange(v);
      }}
      onBlur={() => {
        editing.current = false;
        let v = parse(text);
        if (v == null) v = fallback ?? min;
        v = Math.min(max, Math.max(min, v));
        setText(String(v));
        if (v !== value) onChange(v);
      }}
    />
  );
}
