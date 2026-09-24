"use client";

// 도원 Admin(tg_m) components/confirm-delete.tsx를 그대로 이식한 삭제 확인 모달.
import { Button, Modal } from "@/components/ui/Primitives";

export function ConfirmDelete({
  open,
  name,
  label = "정보",
  onClose,
  onConfirm,
  description,
}: {
  open: boolean;
  name: string;
  label?: string;
  onClose: () => void;
  onConfirm: () => void;
  description?: string;
}) {
  return (
    <Modal open={open} title="삭제 확인" onClose={onClose}>
      <div className="space-y-5">
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-800">
          <b>{name}</b>의 {label}를 정말로 삭제하시겠습니까?
          <br />
          <span className="text-xs text-red-600">{description ?? "삭제한 데이터는 복구할 수 없습니다."}</span>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            아니오
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            예, 삭제
          </Button>
        </div>
      </div>
    </Modal>
  );
}
