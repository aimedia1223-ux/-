import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api } from './data/mockDb';
import type { User } from './data/mockDb';
import { BottomNav } from './components/BottomNav';
import { HomePage } from './pages/HomePage';
import { SearchPage } from './pages/SearchPage';
import { MessagePage } from './pages/MessagePage';
import { ManagementPage } from './pages/ManagementPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsDrawer } from './components/SettingsDrawer';

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);

  const checkUser = async () => {
    try {
      const user = await api.getCurrentUser();
      if (user && user.status !== 'approved') {
        await api.logout();
        setCurrentUser(null);
      } else {
        setCurrentUser(user);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      // Seeding runs in the background so it doesn't block the page loading
      api.seedStaffAttendanceLogs().catch(err => console.error('Seeding error:', err));
      await checkUser();
    };
    init();

    // Listen to custom settings drawer open event
    const handleOpenSettings = () => {
      setShowSettingsDrawer(true);
    };
    window.addEventListener('open-settings-menu', handleOpenSettings);
    return () => {
      window.removeEventListener('open-settings-menu', handleOpenSettings);
    };
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0F172A', color: 'white', fontFamily: 'sans-serif' }}>
        読み込み中...
      </div>
    );
  }

  if (!currentUser) {
    return (
      <Router>
        <Routes>
          <Route path="/login" element={<LoginPage onLoginSuccess={checkUser} />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Router>
    );
  }

  return (
    <Router>
      <div id="app-container">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/message" element={<MessagePage />} />
          <Route path="/manage" element={<ManagementPage />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <BottomNav />
        <SettingsDrawer 
          isOpen={showSettingsDrawer} 
          onClose={() => setShowSettingsDrawer(false)} 
          onLogoutSuccess={checkUser} 
        />
      </div>
    </Router>
  );
}

export default App;
