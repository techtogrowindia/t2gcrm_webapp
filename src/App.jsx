import React from 'react';
import db from './instant';
import { ToastProvider } from './context/ToastContext';
import { AppProvider } from './context/AppContext';
import AuthScreen from './components/Auth/AuthScreen';
import MainApp from './components/Layout/MainApp';
import StorePage from './components/Ecommerce/StorePage';
import TrackingPage from './components/Ecommerce/TrackingPage';
import BookingPage from './components/Appointments/BookingPage';
import UserManual from './components/System/UserManual';
import WAVariableGuide from './components/Settings/WAVariableGuide';
import PartnerRegistration from './components/Partners/PartnerRegistration';
import PartnerApp from './components/Partners/PartnerApp';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("T2GCRM Crash:", error, errorInfo);
    // Auto-reload on chunk load failures (happens after deployment when old assets are gone)
    if (error?.message?.includes('Failed to fetch dynamically imported module') || error?.message?.includes('Loading chunk')) {
      if (!sessionStorage.getItem('chunk_reload')) {
        sessionStorage.setItem('chunk_reload', '1');
        window.location.reload();
        return;
      }
      sessionStorage.removeItem('chunk_reload');
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', background: '#fff', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 60, marginBottom: 20 }}>🚧</div>
          <h1 style={{ marginBottom: 10 }}>Oops! Something went wrong.</h1>
          <p style={{ color: '#64748b', marginBottom: 20 }}>The application encountered a runtime error and crashed.</p>
          <div style={{ background: '#f1f5f9', padding: 20, borderRadius: 8, maxWidth: 600, width: '100%', textAlign: 'left', marginBottom: 20, overflowX: 'auto' }}>
            <code style={{ color: '#dc2626', fontSize: 13, whiteSpace: 'pre-wrap' }}>{this.state.error?.toString()}</code>
          </div>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload Application</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppInner() {
  const { isLoading, user, error } = db.useAuth();
  const { data } = db.useQuery({ globalSettings: {} });
  const rawSettings = data?.globalSettings?.[0] || {};
  const settings = {
    brandName: rawSettings.brandName || '',
    brandShort: rawSettings.brandShort || '',
    title: rawSettings.title || '',
    favicon: rawSettings.favicon || '',
    crmDomain: rawSettings.crmDomain || '',
    brandLogo: rawSettings.brandLogo || '',
    showBranding: rawSettings.showBranding !== false,
    mobileAppIcon: rawSettings.mobileAppIcon || '',
    plans: rawSettings.plans ? JSON.parse(rawSettings.plans) : null,
  };

  // Partner discovery — MUST be before any early returns (Rules of Hooks)
  const storedPartner = localStorage.getItem('tc_channel_partner');
  const partnerQuery = (!storedPartner && user?.email)
    ? { partnerApplications: { $: { where: { email: String(user.email).toLowerCase() }, limit: 1 } } }
    : null;
  const { data: partnerData, isLoading: partnerLoading } = db.useQuery(partnerQuery);

  React.useEffect(() => {
    document.title = settings.title || settings.brandName || 'T2GCRM';
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    if (settings.favicon) {
      link.href = settings.favicon;
    }
  }, [settings.title, settings.brandName, settings.favicon]);

  // --- All hooks above. Early returns below are safe. ---

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="logo">{settings.brandShort || 'T2G'}</div>
        <div className="spinner" />
        <p>Loading {settings.brandName || 'T2GCRM'}...</p>
      </div>
    );
  }

  const path = window.location.pathname.toLowerCase();
  const isPublicStore = path.endsWith('/store');
  const isPublicOrders = path.endsWith('/orders');
  const isPublicBooking = path.endsWith('/book') || path.endsWith('/appointment');
  const isPublicManual = path.endsWith('/manual');
  const isWAGuide = path.endsWith('/wa-guide');
  const isPartnerReg = path.includes('/partner/register');

  if (isPublicManual) return <UserManual isPublic={true} settings={settings} />;
  if (isWAGuide) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: 20 }}>
      <WAVariableGuide standaloneMode />
    </div>
  );
  if (isPublicStore) return <StorePage />;
  if (isPublicOrders) return <TrackingPage />;
  if (isPublicBooking) return <BookingPage />;
  if (isPartnerReg) return <PartnerRegistration params={{ slug: path.split('/')[1] !== 'partner' ? path.split('/')[1] : '' }} />;

  if (!user) {
    return <AuthScreen settings={settings} />;
  }

  // Partner discovery (hooks already called above)
  const isDiscoveringPartner = !!partnerQuery && partnerLoading;

  if (isDiscoveringPartner) {
    return (
      <div className="loading-screen">
        <div className="logo">{settings.brandShort || 'T2G'}</div>
        <div className="spinner" />
        <p>Discovering account type...</p>
      </div>
    );
  }

  let finalPartnerInfo = null;
  if (storedPartner) {
    try { finalPartnerInfo = JSON.parse(storedPartner); } catch(e) {}
  } else if (partnerData?.partnerApplications?.[0]) {
    const p = partnerData.partnerApplications[0];
    finalPartnerInfo = {
      isPartner: true,
      ownerUserId: p.userId,
      partnerId: p.id,
      role: p.role,
      status: p.status
    };
    if (p.status === 'Approved') {
      localStorage.setItem('tc_channel_partner', JSON.stringify(finalPartnerInfo));
    }
  }

  if (finalPartnerInfo?.isPartner) {
    if (finalPartnerInfo.status === 'Pending' || finalPartnerInfo.status === 'Rejected') {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: 20 }}>
          <div style={{ background: '#fff', padding: 40, borderRadius: 16, boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', textAlign: 'center', maxWidth: 400 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>{finalPartnerInfo.status === 'Pending' ? '⏳' : '❌'}</div>
            <h2 style={{ margin: '0 0 12px 0', fontSize: 24, color: '#0f172a' }}>{finalPartnerInfo.status === 'Pending' ? 'Approval Pending' : 'Application Rejected'}</h2>
            <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 24px 0', lineHeight: 1.6 }}>
              {finalPartnerInfo.status === 'Pending' 
                ? 'Your partner account is actively being reviewed by the administration. You will be able to log in once you are approved.' 
                : 'Your partner application could not be approved at this time. Please contact support for details.'}
            </p>
            <button 
              onClick={() => { localStorage.removeItem('tc_channel_partner'); db.auth.signOut(); window.location.href='/'; }}
              style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}
            >
              Sign Out
            </button>
          </div>
        </div>
      );
    }

    return (
      <ErrorBoundary>
        <AppProvider user={user}>
          <PartnerApp user={user} settings={settings} partnerInfo={finalPartnerInfo} />
        </AppProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <AppProvider user={user}>
        <MainApp user={user} settings={settings} />
      </AppProvider>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
