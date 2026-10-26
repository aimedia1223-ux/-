// 新DBの画面表示で利用する列だけを取得する。認証情報は取得しない。
export const readColumns: Record<'companies' | 'staffs' | 'jobs' | 'talents' | 'contract_tasks' | 'announcements', string> = {
  companies: 'id,name,role,status,invoice_number,representative_name,email,website,address,pr_text,company_type,gender,contract_template,contract_pdf',
  staffs: 'id,user_id,name,masked_name,base_location,nearest_station,preferred_area,price,skills,carriers,experience,pr_text,completed_trainings,has_certificate',
  jobs: 'id,author_id,title,description,lat,lng,price,location_name,work_hours,requirements,detailed_description,role_type,sales_channel,carrier,event_date,application_deadline,work_location,is_urgent,allowed_company_ids,exact_location',
  talents: 'id,user_id,name,description,lat,lng,price,skills,pr_text,experience,preferred_area,location_name,company_name,masked_name,base_location,nearest_station,carriers,available_dates,completed_trainings,has_certificate',
  contract_tasks: 'id,job_id,job_title,worker_name,company_name,client_name,client_id,agency_id,price,date,status,disputed_reason,evaluations,client_contract_text,agency_contract_text,client_contract_pdf,agency_contract_pdf,client_contract_approved_by_client,client_contract_approved_by_agency,agency_contract_approved_by_client,agency_contract_approved_by_agency',
  announcements: 'id,date,title,content,is_important',
};
