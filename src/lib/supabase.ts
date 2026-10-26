import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabasePublicKey } from './supabaseConfig';

// 接続情報はリポジトリへ直接書かず、ローカルまたはGitHub Secretsから注入する。
// 未設定時は新しい個人認証を利用できない。認証ではデモへ切り替えない。
export const supabase = createClient(supabaseUrl, supabasePublicKey);
