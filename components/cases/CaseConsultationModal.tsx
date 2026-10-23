"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import type { CaseRecord, ConsultDirection, DbLead } from "@/lib/types";
import { canReadLeadForProfile } from "@/lib/writing-staff";
import { fmtDate } from "@/lib/format";
import { ConsultationModal } from "@/components/ui/consultation/ConsultationModal";
import { caseConsultationLead } from "@/lib/case-consultation";

/** Edits the explicitly linked original DB through its existing save path. */
export function CaseConsultationModal({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const { cases, clients, leads, profile, superAdminFirmScope, currentStaff, can } = useStore();
  const firmId = profile?.platformRole === "super_admin" ? superAdminFirmScope?.id : profile?.lawFirmId;
  const record = cases.find(item => item.id === caseId);
  const client = clients.find(item => item.id === record?.clientId);
  const lead = record ? caseConsultationLead(record, client, leads, firmId) : undefined;
  const canReadCase = can("cases.view") && (can("cases.view_all") || (!!currentStaff && record?.assignedStaff === currentStaff));
  if (!record || !lead || !canReadCase || !can("db.view_consultation") || !canReadLeadForProfile(profile, lead, can, currentStaff)) return null;
  const resetKey = `case-consultation:${profile?.id ?? ""}:${firmId}:${lead.id}`;
  return <CaseConsultationEditor key={`${resetKey}:${record.id}`} lead={lead} record={record} resetKey={resetKey} onClose={onClose} />;
}

function CaseConsultationEditor({ lead, record, resetKey, onClose }: {
  lead: DbLead; record: CaseRecord; resetKey: string; onClose: () => void;
}) {
  const { profile, currentStaff, can, updateLead } = useStore();
  // A changed identity remounts this controller. A mount effect here would run
  // after the child's localStorage restore and overwrite its restored values.
  const [applicationType, setApplicationType] = useState<ConsultDirection | undefined>(lead.applicationType);
  const [reservationChoice, setReservationChoice] = useState<boolean | undefined>(!!lead.reservationAt);
  const [reservationAt, setReservationAt] = useState<string | undefined>(lead.reservationAt);
  const canReadCase = can("cases.view") && (can("cases.view_all") || (!!currentStaff && record.assignedStaff === currentStaff));
  const readOnly = !can("db.edit_consultation");
  return <ConsultationModal
    open
    resetKey={resetKey}
    onClose={onClose}
    displayName={lead.name}
    displayPhone={lead.phone}
    allowPhoneEdit={!readOnly && can("db.edit_basic")}
    joinedAtLabel={fmtDate(lead.receivedAt)}
    caseNumberLabel={record.caseNumber}
    allowNameEdit={!readOnly && can("db.edit_basic")}
    applicationType={applicationType}
    onApplicationTypeChange={setApplicationType}
    allowApplicationTypeEdit={!readOnly && can("db.edit_basic")}
    initialConsultation={lead.consultation}
    contractAmount={record.contractAmount}
    paidAmount={record.paidAmount}
    outstandingAmount={Math.max(0, record.contractAmount - record.paidAmount)}
    showFinanceSummary={can("cases.view_finance") && can("db.view_finance")}
    readOnly={readOnly}
    reservationChoice={reservationChoice}
    reservationAt={reservationAt}
    onReservationChoiceChange={!readOnly && can("db.manage_reservation") ? value => {
      setReservationChoice(value);
      if (value !== true) setReservationAt(undefined);
    } : undefined}
    onReservationAtChange={!readOnly && can("db.manage_reservation") ? setReservationAt : undefined}
    onSave={async (consultation, customerName, customerPhone) => {
      if (!canReadCase || !can("db.view_consultation") || !can("db.edit_consultation") || !canReadLeadForProfile(profile, lead, can, currentStaff)) return false;
      const patch: Partial<DbLead> = { consultation };
      if (can("db.edit_basic")) {
        if (customerName !== undefined && customerName !== lead.name) patch.name = customerName;
        // The existing lead trigger synchronizes its linked client atomically.
        if (customerPhone !== undefined && customerPhone !== lead.phone) patch.phone = customerPhone;
        patch.applicationType = applicationType;
      }
      if (can("db.manage_reservation")) patch.reservationAt = reservationChoice === true ? reservationAt : undefined;
      return await updateLead(lead.id, patch);
    }}
  />;
}
