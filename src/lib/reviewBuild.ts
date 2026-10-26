const revision = import.meta.env.VITE_BUILD_REVISION || '';
export const reviewBuildLabel = /^[a-f0-9]{40}$/i.test(revision) ? revision.slice(0, 7) : 'ローカル確認版';
