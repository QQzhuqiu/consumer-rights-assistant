'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 凭证选择与本地预览组件（阶段四）。
 *
 * 严格边界：
 *   · 单文件；仅接受 JPEG / PNG / WebP / PDF，最大 10 MiB；
 *   · 文件只存在于浏览器内存，通过 URL.createObjectURL 生成预览地址；
 *   · **不发起任何网络请求**，不上传、不写入 localStorage/sessionStorage；
 *   · 不做 OCR、不做 AI 分析、不做数据库读写。
 *
 * 对象 URL 生命周期（集中在此文件内，便于审查）：
 *   · 创建：校验通过后创建，并把当前 URL 存入 objectUrlRef；
 *   · 替换：先释放旧 URL，再创建新 URL；
 *   · 移除：释放 URL 并清空状态；
 *   · 卸载：useEffect 清理函数释放仍存在的 URL。
 *   任何时候最多只有一个对象 URL 存活，且不会在渲染过程中重复创建。
 */

/** 单文件上限：10 MiB */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** 文件选择框的 accept 属性，精确限定四类 MIME */
const ACCEPT_ATTR = 'image/jpeg,image/png,image/webp,application/pdf';

/** 允许的 MIME 白名单 */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

/** MIME → 人类可读的类型名称 */
const TYPE_LABELS: Record<string, string> = {
  'image/jpeg': 'JPEG 图片',
  'image/png': 'PNG 图片',
  'image/webp': 'WebP 图片',
  'application/pdf': 'PDF 文档',
};

type FileKind = 'image' | 'pdf';

type SelectedEvidence = {
  /** 浏览器内存中的文件对象本身，不持久化 */
  file: File;
  /** 本地对象 URL */
  objectUrl: string;
  /** 预览方式 */
  kind: FileKind;
  /** 类型的中文名称 */
  typeLabel: string;
};

/** 把字节数格式化为易读形式 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(kilobytes < 10 ? 1 : 0)} KB`;
  }

  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(megabytes < 10 ? 1 : 2)} MB`;
}

/**
 * 校验单个文件。
 * 返回 null 表示通过；返回字符串表示不通过，内容为面向用户的中文说明。
 */
function validateFile(file: File): string | null {
  // 部分系统/浏览器不提供 MIME 信息，此时无法确认类型，按不支持处理
  if (file.type === '') {
    return `无法确定该文件的类型，因此不能预览。请选择 JPEG、PNG、WebP 图片或 PDF 文件。`;
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return `不支持该文件类型（${file.type}）。当前仅支持 JPEG、PNG、WebP 图片与 PDF 文件。`;
  }

  if (file.size > MAX_FILE_SIZE) {
    return `文件为 ${formatFileSize(file.size)}，超过 10 MiB 上限。请选择更小的文件。`;
  }

  return null;
}

export default function EvidencePreview() {
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * 当前存活的对象 URL。
   * 用 ref 而非 state 保存，避免它参与渲染比较；状态里只保留展示所需的数据。
   */
  const objectUrlRef = useRef<string | null>(null);

  const [selected, setSelected] = useState<SelectedEvidence | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** PDF 内嵌预览失败时置为 true，改用文本占位 */
  const [pdfEmbedFailed, setPdfEmbedFailed] = useState(false);

  /** 释放当前对象 URL（若存在）。可安全重复调用。 */
  const releaseObjectUrl = useCallback(() => {
    if (objectUrlRef.current !== null) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  /** 卸载时释放仍存活的对象 URL，避免内存泄漏 */
  useEffect(() => {
    return () => {
      releaseObjectUrl();
    };
  }, [releaseObjectUrl]);

  /** 清空原生 input 的值，使再次选择同一个文件也能触发 change 事件 */
  const resetInputValue = useCallback(() => {
    if (inputRef.current !== null) {
      inputRef.current.value = '';
    }
  }, []);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;

      // 用户取消对话框：保持现状，不做任何清理
      if (file === null) return;

      const validationMessage = validateFile(file);

      if (validationMessage !== null) {
        // 校验失败：释放可能存在的旧 URL，清空预览，仅展示错误
        releaseObjectUrl();
        setSelected(null);
        setPdfEmbedFailed(false);
        setError(validationMessage);
        resetInputValue();
        return;
      }

      // 校验通过：先释放旧 URL（替换场景），再创建新 URL
      releaseObjectUrl();

      const objectUrl = URL.createObjectURL(file);
      objectUrlRef.current = objectUrl;

      setError(null);
      setPdfEmbedFailed(false);
      setSelected({
        file,
        objectUrl,
        kind: file.type === 'application/pdf' ? 'pdf' : 'image',
        typeLabel: TYPE_LABELS[file.type] ?? file.type,
      });
    },
    [releaseObjectUrl, resetInputValue],
  );

  const handleRemove = useCallback(() => {
    releaseObjectUrl();
    setSelected(null);
    setError(null);
    setPdfEmbedFailed(false);
    resetInputValue();
  }, [releaseObjectUrl, resetInputValue]);

  /**
   * 替换：清空 input 值后重新打开文件选择框。
   * 无论用户是否最终选中文件，现有预览都保持不变；选中新文件时走 handleFileChange
   * 的「先释放旧 URL、再创建新 URL」路径。
   */
  const handleReplace = useCallback(() => {
    resetInputValue();
    inputRef.current?.click();
  }, [resetInputValue]);

  const hasError = error !== null;

  return (
    <section
      aria-labelledby="evidence-heading"
      className="mt-8 rounded-lg border border-slate-200 bg-white p-4 sm:p-5"
    >
      <h2
        id="evidence-heading"
        className="text-base font-semibold text-slate-900 sm:text-lg"
      >
        凭证本地预览
      </h2>

      <p id="evidence-hint" className="mt-2 text-sm leading-relaxed text-slate-600">
        支持 JPEG、PNG、WebP 图片与 PDF 文件，单个文件不超过 10 MiB。
        <br />
        <strong className="font-semibold text-slate-800">
          文件仅在浏览器本地预览，不会上传服务器。
        </strong>
      </p>

      {/* ---------- 原生文件选择控件 ---------- */}
      <div className="mt-4">
        <label
          htmlFor="evidence-file-input"
          className="block text-xs font-medium text-slate-700"
        >
          选择凭证文件
        </label>
        <input
          ref={inputRef}
          id="evidence-file-input"
          type="file"
          accept={ACCEPT_ATTR}
          onChange={handleFileChange}
          aria-describedby={hasError ? 'evidence-hint evidence-error' : 'evidence-hint'}
          aria-invalid={hasError || undefined}
          className="mt-1.5 block w-full max-w-full cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        />
      </div>

      {/* ---------- 错误提示（关联到文件选择区域） ---------- */}
      {hasError && (
        <p
          id="evidence-error"
          role="alert"
          className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-800"
        >
          {error}
        </p>
      )}

      {/* ---------- 未选择文件时的空状态 ---------- */}
      {selected === null && (
        <p className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          选择图片或 PDF 凭证进行预览
        </p>
      )}

      {/* ---------- 已选择文件：预览 + 文件信息 ---------- */}
      {selected !== null && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* 预览区 */}
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            {selected.kind === 'image' ? (
              /* eslint-disable-next-line @next/next/no-img-element --
                 本地对象 URL 由浏览器直接提供给 <img>，无法用 next/image 优化 */
              <img
                src={selected.objectUrl}
                alt={`本地预览：${selected.file.name}`}
                className="mx-auto block max-h-[420px] w-auto max-w-full rounded object-contain"
              />
            ) : pdfEmbedFailed ? (
              <div className="flex min-h-[240px] flex-col items-center justify-center rounded border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
                <p className="text-sm font-medium text-slate-700">
                  当前浏览器无法内嵌预览该 PDF
                </p>
                <p className="mt-2 max-w-md text-xs leading-relaxed text-slate-500">
                  这不是文件损坏，也不代表文件已被解析——页面只是没有可用的内嵌
                  PDF 查看器。请用本地 PDF 阅读器打开查看内容。
                </p>
              </div>
            ) : (
              <iframe
                src={selected.objectUrl}
                title={`PDF 本地预览：${selected.file.name}`}
                className="h-[420px] w-full rounded border border-slate-200 bg-white"
                onError={() => setPdfEmbedFailed(true)}
              />
            )}

            {selected.kind === 'pdf' && !pdfEmbedFailed && (
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                部分浏览器不提供内嵌 PDF 查看器。若上方区域为空白，请改用本地 PDF
                阅读器打开该文件；页面并未解析其内容。
              </p>
            )}
          </div>

          {/* 文件信息 */}
          <div className="flex flex-col rounded-md border border-slate-200 p-3">
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs font-medium text-slate-500">文件名</dt>
                <dd className="mt-0.5 break-all text-slate-800">
                  {selected.file.name}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500">类型</dt>
                <dd className="mt-0.5 text-slate-800">{selected.typeLabel}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500">大小</dt>
                <dd className="mt-0.5 text-slate-800">
                  {formatFileSize(selected.file.size)}
                </dd>
              </div>
            </dl>

            <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">
              文件目前只保存在本页面的浏览器内存中。刷新或关闭页面后需要重新选择。
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleReplace}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                替换文件
              </button>
              <button
                type="button"
                onClick={handleRemove}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                移除文件
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
