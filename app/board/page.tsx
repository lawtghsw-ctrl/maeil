"use client";

// 도원 Admin(tg_m) 내부 게시판과 동일한 기능(공지 고정·순서, 검색, 첨부파일)을 이식.
// 실제 백엔드가 없는 데모라 첨부파일은 이름/용량만 기록하고 실제 다운로드는 제공하지 않습니다.
import { useMemo, useState, type ChangeEvent } from "react";
import { useStore } from "@/lib/store";
import type { BoardAttachment, BoardPost } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  Modal,
  NumberInput,
  PageHeader,
  Pagination,
  SearchBox,
  pageRows,
} from "@/components/ui/Primitives";
import { ConfirmDelete } from "@/components/ui/ConfirmDelete";
import { Paperclip, Plus } from "lucide-react";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emptyDraft(): Omit<BoardPost, "id"> {
  return { title: "", body: "", writer: "직원1", date: today(), isNotice: false, noticeOrder: 1, attachments: [] };
}

const textarea =
  "min-h-48 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:text-sm";

export default function BoardPage() {
  const { posts, addPost, updatePost, deletePost } = useStore();
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [delTarget, setDelTarget] = useState<BoardPost | null>(null);
  const [form, setForm] = useState<Omit<BoardPost, "id">>(emptyDraft());

  const rows = useMemo(() => {
    return posts
      .filter((p) => `${p.title} ${p.body} ${p.writer}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => {
        if (a.isNotice !== b.isNotice) return a.isNotice ? -1 : 1;
        if (a.isNotice) return a.noticeOrder - b.noticeOrder;
        return a.date < b.date ? 1 : -1;
      });
  }, [posts, query]);

  const viewing = posts.find((p) => p.id === viewId);

  function beginAdd() {
    setEditingId(null);
    setForm(emptyDraft());
    setOpen(true);
  }

  function beginEdit(p: BoardPost) {
    setEditingId(p.id);
    setForm({
      title: p.title,
      body: p.body,
      writer: p.writer,
      date: p.date,
      isNotice: p.isNotice,
      noticeOrder: p.noticeOrder,
      attachments: [...p.attachments],
    });
    setOpen(true);
  }

  function attachFiles(fileList: FileList | null) {
    if (!fileList) return;
    const next: BoardAttachment[] = [...form.attachments];
    Array.from(fileList).forEach((file, i) => {
      next.push({ id: `F-${Date.now()}-${i}`, name: file.name, size: file.size });
    });
    setForm((f) => ({ ...f, attachments: next }));
  }

  function save() {
    if (!form.title.trim()) return;
    if (editingId) updatePost(editingId, form);
    else addPost(form);
    setOpen(false);
  }

  return (
    <>
      <PageHeader
        title="게시판"
        description="공지 고정, 순서 설정, 본문 및 파일 첨부를 지원합니다."
        action={
          <Button onClick={beginAdd}>
            <Plus size={15} />
            글 생성
          </Button>
        }
      />

      <Card className="mb-4 p-3">
        <SearchBox
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(1);
          }}
          onReset={() => {
            setQuery("");
            setPage(1);
          }}
          placeholder="제목, 본문 또는 작성자 검색"
        />
      </Card>

      <Card className="overflow-hidden">
        {/* 모바일: 카드 리스트 */}
        <div className="divide-y divide-slate-100 md:hidden">
          {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-slate-400">등록된 게시글이 없습니다.</div>}
          {pageRows(rows, page, 10).map((p) => (
            <div key={p.id} className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <button className="min-w-0 text-left font-semibold text-slate-900 hover:text-blue-700" onClick={() => setViewId(p.id)}>
                  {p.title}
                </button>
                {p.isNotice && <Badge tone="blue">공지 {p.noticeOrder}</Badge>}
              </div>
              <div className="text-xs text-slate-400">
                {p.writer} · {fmtDate(p.date)} · 첨부 {p.attachments.length ? `${p.attachments.length}개` : "없음"}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => beginEdit(p)}>
                  수정
                </Button>
                <Button variant="danger" className="flex-1" onClick={() => setDelTarget(p)}>
                  삭제
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* 데스크톱: 테이블 */}
        <div className="hidden overflow-x-auto md:block">
          <table className="admin-responsive-table w-full min-w-[850px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {["구분", "제목", "작성자", "등록일", "첨부", ""].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows(rows, page, 10).map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">{p.isNotice ? <Badge tone="blue">공지 {p.noticeOrder}</Badge> : "일반"}</td>
                  <td className="px-4 py-3">
                    <button className="font-semibold hover:text-blue-700" onClick={() => setViewId(p.id)}>
                      {p.title}
                    </button>
                  </td>
                  <td className="px-4 py-3">{p.writer}</td>
                  <td className="px-4 py-3">{fmtDate(p.date)}</td>
                  <td className="px-4 py-3">{p.attachments.length ? `${p.attachments.length}개` : "-"}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="secondary" onClick={() => beginEdit(p)}>
                        수정
                      </Button>
                      <Button variant="danger" onClick={() => setDelTarget(p)}>
                        삭제
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                    등록된 게시글이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={rows.length} onChange={setPage} pageSize={10} />
      </Card>

      <Modal open={open} title={editingId ? "게시글 수정" : "게시글 생성"} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <Label text="제목">
            <Input value={form.title} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, title: e.target.value })} />
          </Label>
          <Label text="본문">
            <textarea
              className={textarea}
              value={form.body}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, body: e.target.value })}
            />
          </Label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Label text="작성자">
              <Input value={form.writer} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, writer: e.target.value })} />
            </Label>
            <Label text="등록일">
              <input
                type="date"
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:h-10 sm:text-sm"
                value={form.date}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, date: e.target.value })}
              />
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={form.isNotice}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, isNotice: e.target.checked })}
              />
              공지사항
            </label>
            {form.isNotice && <NumberInput min={1} className="w-28" value={form.noticeOrder} onChange={(v) => setForm({ ...form, noticeOrder: v })} />}
          </div>
          <div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-50">
              <Paperclip size={15} />
              파일 첨부
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e: ChangeEvent<HTMLInputElement>) => attachFiles(e.target.files)}
              />
            </label>
            <div className="mt-2 space-y-1">
              {form.attachments.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                  <span>
                    {a.name} · {(a.size / 1024 / 1024).toFixed(2)}MB
                  </span>
                  <button
                    className="text-red-600"
                    onClick={() => setForm({ ...form, attachments: form.attachments.filter((x) => x.id !== a.id) })}
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button onClick={save}>저장</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!viewing} title={viewing?.title || "게시글"} onClose={() => setViewId(null)}>
        {viewing && (
          <div>
            <div className="mb-4 flex flex-wrap gap-3 text-xs text-slate-400">
              <span>{viewing.writer}</span>
              <span>{fmtDate(viewing.date)}</span>
              {viewing.isNotice && <Badge tone="blue">공지</Badge>}
            </div>
            <div className="whitespace-pre-wrap text-sm leading-7">{viewing.body}</div>
            {viewing.attachments.length > 0 && (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <b className="text-sm">첨부파일</b>
                <div className="mt-2 space-y-2">
                  {viewing.attachments.map((a) => (
                    <div key={a.id} className="flex w-full items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
                      <span>{a.name}</span>
                      <span className="text-xs">{(a.size / 1024 / 1024).toFixed(2)}MB</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[11px] text-slate-400">※ 데모 버전에서는 첨부파일 다운로드를 지원하지 않습니다.</div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDelete
        open={!!delTarget}
        name={delTarget?.title || "게시글"}
        label="게시글"
        onClose={() => setDelTarget(null)}
        onConfirm={() => {
          if (delTarget) deletePost(delTarget.id);
        }}
      />
    </>
  );
}
