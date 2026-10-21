"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { AUTOMATION_IMAGE_ACCEPT, MAX_AUTOMATION_IMAGES, validateAutomationImageFiles } from "@/lib/sms/automation-images";

export type AutomationImagePickerProps = {
  label: string;
  files: File[];
  savedPaths: string[];
  disabled?: boolean;
  onFilesChange: (files: File[]) => void;
  onSavedPathsChange: (paths: string[]) => void;
  /** Stable callback lets the parent prevent saving before selected bytes are validated. */
  onValidationChange?: (validating: boolean) => void;
  /** The parent must scope this resolver and the picker's React key to the current firm/staff. */
  resolveSavedUrl: (path: string) => Promise<string | null>;
};

function LocalImagePreview({ file }: { file: File }) {
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    let url: string;
    try { url = URL.createObjectURL(file); }
    catch { setPreview(null); return; }
    setPreview({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return preview?.file === file
    ? <img src={preview.url} alt={`${file.name} 미리보기`} onError={() => setPreview(null)} className="h-16 w-20 shrink-0 rounded-lg bg-white object-contain"/>
    : <span className="flex h-16 w-20 shrink-0 items-center justify-center rounded-lg bg-white text-center text-[10px] text-slate-400">미리보기 없음</span>;
}

function SavedImagePreview({ path, resolveSavedUrl }: Pick<AutomationImagePickerProps, "resolveSavedUrl"> & { path: string }) {
  const [preview, setPreview] = useState<{ path: string; resolver: typeof resolveSavedUrl; url: string | null } | null>(null);
  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => resolveSavedUrl(path)).then(
      (url) => { if (current) setPreview({ path, resolver: resolveSavedUrl, url }); },
      () => { if (current) setPreview({ path, resolver: resolveSavedUrl, url: null }); },
    );
    return () => { current = false; };
  }, [path, resolveSavedUrl]);
  const loaded = preview?.path === path && preview.resolver === resolveSavedUrl;
  return loaded && preview.url
    ? <img src={preview.url} alt={`${path.split("/").pop()} 저장된 이미지 미리보기`} onError={() => setPreview({ path, resolver: resolveSavedUrl, url: null })} className="h-16 w-20 shrink-0 rounded-lg bg-white object-contain"/>
    : <span className="flex h-16 w-20 shrink-0 items-center justify-center rounded-lg bg-white text-center text-[10px] text-slate-400">{loaded ? "미리보기 없음" : "불러오는 중"}</span>;
}

/** Selection is local only. Saving/uploading remains the parent's explicit action. */
export default function AutomationImagePicker(props: AutomationImagePickerProps) {
  const { label, files, savedPaths, disabled = false, onFilesChange, onSavedPathsChange, resolveSavedUrl } = props;
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const validationActive = useRef(false);
  const dragDepth = useRef(0);
  const latest = useRef(props);
  latest.current = props;
  const [dragging, setDragging] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState("");
  function reportValidation(active: boolean) {
    if (validationActive.current !== active) {
      validationActive.current = active;
      latest.current.onValidationChange?.(active);
    }
    if (mounted.current) setValidating(active);
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
      if (validationActive.current) {
        validationActive.current = false;
        latest.current.onValidationChange?.(false);
      }
    };
  }, []);
  useEffect(() => {
    if (disabled) {
      sequence.current++;
      dragDepth.current = 0;
      setDragging(false);
      reportValidation(false);
    }
  }, [disabled]);

  function cancelValidation() {
    sequence.current++;
    reportValidation(false);
    setError("");
  }

  async function selectFiles(next: File[]) {
    if (latest.current.disabled || !next.length) return;
    const request = ++sequence.current;
    setError("");
    reportValidation(true);
    try {
      await validateAutomationImageFiles(next);
      if (mounted.current && request === sequence.current && !latest.current.disabled) latest.current.onFilesChange(next);
    } catch (failure) {
      if (mounted.current && request === sequence.current && !latest.current.disabled) {
        setError(failure instanceof Error ? failure.message : "이미지를 확인하지 못했습니다. 다시 선택해주세요.");
      }
    } finally {
      if (mounted.current && request === sequence.current) reportValidation(false);
    }
  }

  function preventFileNavigation(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  const count = files.length || savedPaths.length;
  return <fieldset disabled={disabled} className="mt-4 min-w-0" aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}>
    <legend className="text-sm font-bold text-slate-700">{label} ({count}/{MAX_AUTOMATION_IMAGES})</legend>
    <div
      onDragEnter={(event) => {
        preventFileNavigation(event);
        if (!latest.current.disabled && Array.from(event.dataTransfer.types).includes("Files")) { dragDepth.current++; setDragging(true); }
      }}
      onDragOver={(event) => { preventFileNavigation(event); event.dataTransfer.dropEffect = latest.current.disabled ? "none" : "copy"; }}
      onDragLeave={(event) => {
        preventFileNavigation(event);
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(event) => {
        preventFileNavigation(event);
        dragDepth.current = 0;
        setDragging(false);
        void selectFiles(Array.from(event.dataTransfer.files));
      }}
      className={`mt-2 rounded-xl border-2 border-dashed transition-colors ${disabled ? "border-slate-200 bg-slate-50 opacity-50" : dragging ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-slate-50"}`}
    >
      <button type="button" disabled={disabled} onClick={() => { if (!latest.current.disabled) input.current?.click(); }} aria-controls={`${id}-input`} aria-describedby={`${id}-help`} className="flex min-h-24 w-full flex-col items-center justify-center gap-1 rounded-xl p-4 text-sm font-bold text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed">
        <span>{dragging ? "여기에 이미지를 놓아주세요" : "이미지를 끌어놓거나 클릭하여 선택"}</span>
        <span className="text-xs font-normal text-slate-500">{label} 파일 선택</span>
      </button>
      <input ref={input} id={`${id}-input`} type="file" accept={AUTOMATION_IMAGE_ACCEPT} multiple disabled={disabled} className="hidden" aria-label={`${label} 파일 선택`} onChange={(event) => {
        const next = Array.from(event.target.files ?? []);
        event.target.value = "";
        void selectFiles(next);
      }}/>
    </div>
    <p id={`${id}-help`} className="mt-2 text-xs leading-5 text-slate-500">JPEG·PNG·GIF · 최대 3개 · 총 2MB 이하. 새로 선택한 파일은 기존 첨부 목록을 대체하며, 설정 저장 시 적용됩니다.</p>
    {files.length > 0 && savedPaths.length > 0 && <p className="mt-1 text-xs leading-5 text-amber-700">저장된 이미지 {savedPaths.length}개를 새 이미지 {files.length}개로 교체합니다. 새 이미지를 모두 제거하면 저장된 이미지가 유지됩니다.</p>}
    {validating && <p role="status" className="mt-2 text-xs text-indigo-700">이미지 형식과 용량을 확인하고 있습니다.</p>}
    {error && <p id={`${id}-error`} role="alert" className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
    {count > 0 && <ul className="mt-2 space-y-2">
      {files.length > 0 ? files.map((file, index) => <li key={`${index}-${file.name}`} className="flex min-w-0 items-center gap-3 rounded-xl bg-slate-50 p-3">
        <LocalImagePreview file={file}/>
        <div className="min-w-0 flex-1"><p className="break-all text-xs font-semibold text-slate-700">새 이미지 · {file.name}</p><p className="mt-1 text-xs text-slate-500">{Math.ceil(file.size / 1024)}KB · 저장 대기</p></div>
        <button type="button" disabled={disabled} aria-label={`${label}: ${file.name} 제거`} onClick={() => { if (latest.current.disabled) return; cancelValidation(); onFilesChange(files.filter((_, item) => item !== index)); }} className="shrink-0 rounded-lg px-2 py-2 text-xs font-bold text-red-500 disabled:opacity-40">제거</button>
      </li>) : savedPaths.map((path, index) => <li key={path} className="flex min-w-0 items-center gap-3 rounded-xl bg-slate-50 p-3">
        <SavedImagePreview path={path} resolveSavedUrl={resolveSavedUrl}/>
        <p className="min-w-0 flex-1 break-all text-xs text-slate-600">저장됨 · {path.split("/").pop()}</p>
        <button type="button" disabled={disabled} aria-label={`${label}: ${path.split("/").pop()} 저장된 이미지 제거`} onClick={() => { if (latest.current.disabled) return; cancelValidation(); onSavedPathsChange(savedPaths.filter((_, item) => item !== index)); }} className="shrink-0 rounded-lg px-2 py-2 text-xs font-bold text-red-500 disabled:opacity-40">제거</button>
      </li>)}
    </ul>}
  </fieldset>;
}
