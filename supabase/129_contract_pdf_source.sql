-- 127番適用後。PDFの生成用に確定済みの内容を再取得する。
-- 生成用の取得を記録する。端末保存完了や電子署名を証明しない。
begin;
alter table connexy_private.audit_events drop constraint audit_events_action_check;
alter table connexy_private.audit_events add constraint audit_events_action_check check(action in (
 'responsibility.saved','responsibility.deleted','agency_manager.saved','agency_manager.deleted',
 'offer.created','offer.confirmed','offer.declined','offer.withdrawn','offer.deleted',
 'contract.created','contract.updated','contract.deleted','message.sent','message.updated','message.deleted',
 'job.created','job.updated','job.deleted','staff.created','staff.updated','staff.deleted','approval.created','approval.revoked','approval.deleted',
 'job_detail.read','responsibility.read','agency_manager.read','offer.read','message.read','thread.read','audit.read','data.read','staff_export.read',
 'deletion_record.created','deletion_check.saved','deletion_records.read','deletion_record.read','contract_pdf.read'));
create function public.connexy_read_contract_pdf_source(target_offer uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; i record;
begin
 -- 旧文書・未確定・他社・MFA前・二次側の承諾取消等を既存の開示経路で拒否。
 result:=public.connexy_export_contract_document(target_offer);
 select * into i from public.connexy_current_identity();
 perform connexy_private.append_audit(i.company_id,'contract_pdf.read','offer',target_offer::text,1,1);
 return result;
end; $$;
revoke all on function public.connexy_read_contract_pdf_source(uuid) from public,anon;
grant execute on function public.connexy_read_contract_pdf_source(uuid) to authenticated;
commit;
