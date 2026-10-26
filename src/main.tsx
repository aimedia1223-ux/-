import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ReviewNotice } from './components/ReviewNotice'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="app-shell">
      <ReviewNotice />
      <div className="app-content"><App /></div>
    </div>
  </StrictMode>,
)

// 登録処理は同梱スクリプトから実行し、HTMLにインラインJSを置かない。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
