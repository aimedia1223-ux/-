import type { api as managementApi } from '../data/mockDb';

type ManagementApi = Pick<typeof managementApi, 'getContractTasks' | 'getTrainings' | 'getJobs' | 'getUsers' | 'getStaffsByUserId'>;

// 各一覧を独立して取得する。他の一覧の拒否・通信障害でスタッフの取得を止めない。
export async function loadManagementSections(api: ManagementApi, companyId: string) {
  const [tasks, trainings, jobs, companies, staffs] = await Promise.allSettled([
    api.getContractTasks(), api.getTrainings(), api.getJobs(), api.getUsers(), api.getStaffsByUserId(companyId),
  ]);
  return { tasks, trainings, jobs, companies, staffs };
}

export function managementErrorCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  // 生エラー・レスポンス・認証情報を画面へ出さない。
  return typeof code === 'string' && /^[A-Z0-9_]{1,24}$/.test(code) ? code : 'CONNECTION_ERROR';
}
