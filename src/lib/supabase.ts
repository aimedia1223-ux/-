import { createClient } from '@supabase/supabase-js';

// 接続情報はリポジトリへ直接書かず、ローカルまたはGitHub Secretsから注入する。
// 未設定時はAPI呼び出しが失敗し、データ層がオフラインデモへフォールバックする。
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://not-configured.invalid';
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || 'anon-key-not-configured';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
