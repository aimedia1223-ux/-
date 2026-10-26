import { getJobResponsibilities } from '../lib/jobResponsibilities';
import type { JobContacts } from '../lib/jobResponsibilities';

export type ResponsibilityListItem = {
  jobId: string; title: string; contacts: JobContacts | null;
  status: 'saved' | 'unregistered' | 'error';
};

// 自社の取得済み案件について既存の管理者用RPCを使う。取得失敗を未登録と混同しない。
export async function loadResponsibilityList(
  jobs: { id: string; title: string }[],
  read = getJobResponsibilities,
): Promise<ResponsibilityListItem[]> {
  const results: ResponsibilityListItem[] = new Array(jobs.length);
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const index = next++;
      const job = jobs[index];
      try {
        const { contacts } = await read(job.id);
        results[index] = { jobId: job.id, title: job.title, contacts, status: contacts ? 'saved' : 'unregistered' };
      } catch {
        results[index] = { jobId: job.id, title: job.title, contacts: null, status: 'error' };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3,jobs.length) }, () => worker()));
  return results;
}
