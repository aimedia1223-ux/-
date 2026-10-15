// 簡易的なデータ暗号化・復号ユーティリティ
// ※本番環境では、バックエンドまたはSupabaseのpgcryptoなどを用いた堅牢な鍵管理と暗号化を推奨します。

const MOCK_ENCRYPTION_PREFIX = 'ENC:';

/**
 * テキストを暗号化します（モック実装）。
 * 将来的にはWeb Crypto APIや外部ライブラリを使用した暗号化処理に置き換えます。
 * @param text 暗号化する平文
 * @returns 暗号化された文字列
 */
export const encryptData = (text: string | undefined): string | undefined => {
  if (!text) return text;
  // 既に暗号化されている場合はそのまま返す
  if (text.startsWith(MOCK_ENCRYPTION_PREFIX)) return text;
  
  // モック実装: Base64エンコードを利用して暗号化をシミュレート
  try {
    const encoded = btoa(encodeURIComponent(text));
    return `${MOCK_ENCRYPTION_PREFIX}${encoded}`;
  } catch (error) {
    console.error('Encryption failed:', error);
    return text;
  }
};

/**
 * 暗号化されたテキストを復号します（モック実装）。
 * @param encryptedText 暗号化された文字列
 * @returns 復号された平文
 */
export const decryptData = (encryptedText: string | undefined): string | undefined => {
  if (!encryptedText) return encryptedText;
  
  // 暗号化プレフィックスがない場合は平文とみなす
  if (!encryptedText.startsWith(MOCK_ENCRYPTION_PREFIX)) return encryptedText;
  
  try {
    const data = encryptedText.substring(MOCK_ENCRYPTION_PREFIX.length);
    return decodeURIComponent(atob(data));
  } catch (error) {
    console.error('Decryption failed:', error);
    return encryptedText; // 復号失敗時はそのまま返す（フォールバック）
  }
};
