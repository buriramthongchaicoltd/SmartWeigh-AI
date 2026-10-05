import React, { useState } from 'react';
import { AppUser } from '../types';
import { DEFAULT_COMPANY_LOGO_URL } from '../utils/systemConfig';
import {
  ShieldCheck,
  Lock,
  UserCheck,
  KeyRound,
  LogIn,
  AlertCircle
} from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  companyName: string;
  companyLogoUrl?: string;
  onLoginSuccess: (user: AppUser) => Promise<void>;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  companyName,
  companyLogoUrl = DEFAULT_COMPANY_LOGO_URL,
  onLoginSuccess
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  if (!isOpen) return null;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const handleFormLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const result = await response.json();
      if (!response.ok || !result.success || !result.user) {
        setErrorMsg(result.error || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
        return;
      }
      await onLoginSuccess(result.user);
      setUsername('');
      setPassword('');
    } catch (error) {
      console.error('[Auth] Login request failed:', error);
      setErrorMsg('เชื่อมต่อระบบล็อกอินไม่ได้ กรุณาลองใหม่');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden my-auto">
        {/* Top Banner */}
        <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white p-1 flex items-center justify-center shadow-inner shrink-0 overflow-hidden">
              {companyLogoUrl && !logoFailed ? (
                <img
                  src={companyLogoUrl}
                  alt={companyName}
                  className="w-full h-full object-contain"
                  onError={() => setLogoFailed(true)}
                />
              ) : (
                <ShieldCheck className="w-6 h-6 text-blue-600" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight">เข้าสู่ระบบ / สลับบัญชีผู้ใช้งาน</h2>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30">
                  Role-Based Access Control
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 truncate max-w-md">{companyName}</p>
            </div>
          </div>
        </div>

        <div className="p-6">
          <div>
            <form onSubmit={handleFormLogin} className="space-y-4">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-blue-600" />
                  <span>ล็อกอินด้วยชื่อผู้ใช้ & รหัสผ่าน</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  ระบุ Username และ Password เพื่อเข้าใช้งานตามสิทธิ์
                </p>
              </div>

              {errorMsg && (
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ชื่อผู้ใช้งาน (Username)
                </label>
                <div className="relative">
                  <UserCheck className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="เช่น Admin"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  รหัสผ่าน (Password)
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="กรอกรหัสผ่าน"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-2.5 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-sm cursor-pointer active:scale-98"
              >
                <LogIn className="w-4 h-4" />
                <span>{isSubmitting ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'}</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
