import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Lỗi Render:", error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#0f172a',
          color: '#f87171',
          padding: '32px',
          fontFamily: 'monospace',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          boxSizing: 'border-box'
        }}>
          <div style={{
            maxWidth: '800px',
            width: '100%',
            backgroundColor: '#1e293b',
            border: '1px solid #ef4444',
            borderRadius: '16px',
            padding: '24px'
          }}>
            <h2 style={{ color: '#ef4444', marginTop: 0, fontSize: '20px' }}>
              ⚠️ ĐÃ PHÁT HIỆN LỖI RUNTIME TRÊN WEB:
            </h2>
            <div style={{
              backgroundColor: '#0f172a',
              padding: '16px',
              borderRadius: '8px',
              color: '#fca5a5',
              overflowX: 'auto',
              fontSize: '13px',
              lineHeight: '1.5'
            }}>
              <strong>Thông báo lỗi:</strong> {this.state.error?.toString()}
            </div>
            {this.state.errorInfo?.componentStack && (
              <pre style={{
                marginTop: '12px',
                fontSize: '11px',
                color: '#94a3b8',
                maxHeight: '200px',
                overflowY: 'auto'
              }}>
                {this.state.errorInfo.componentStack}
              </pre>
            )}
            <div style={{ marginTop: '20px', display: 'flex', gap: '12px' }}>
              <button
                onClick={() => {
                  localStorage.clear();
                  window.location.reload();
                }}
                style={{
                  backgroundColor: '#ef4444',
                  color: 'white',
                  border: 'none',
                  padding: '10px 18px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '12px'
                }}
              >
                Xóa Bộ Nhớ (Reset Session) & Tải Lại
              </button>
              <button
                onClick={() => window.location.reload()}
                style={{
                  backgroundColor: '#334155',
                  color: 'white',
                  border: 'none',
                  padding: '10px 18px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                Tải Lại Trang
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
)
