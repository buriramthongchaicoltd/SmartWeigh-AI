import React, { useState } from 'react';
import { AppUser, RolePermissions, UserRole } from '../types';
import { DEFAULT_COMPANY_LOGO_URL } from '../utils/systemConfig';
import {
  ShieldCheck,
  Lock,
  UserCheck,
  KeyRound,
  LogIn,
  X,
  AlertCircle,
  CheckCircle2,
  Building2,
  Sparkles
} from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  canClose: boolean;
  users: AppUser[];
  currentUser: AppUser;
  rolePermissions: Record<UserRole, RolePermissions>;
  companyName: string;
  companyLogoUrl?: string;
  onLoginSuccess: (user: AppUser) => void;
  onClose: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  canClose,
  users,
  currentUser,
  rolePermissions,
  companyName,
  companyLogoUrl = DEFAULT_COMPANY_LOGO_URL,
  onLoginSuccess,
  onClose
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  if (!isOpen) return null;

  const activeUsers = users.filter(u => u.status === 'active');

  const handleFormLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const trimmedUser = username.trim().toLowerCase();
    const matched = users.find(u => u.username.trim().toLowerCase() === trimmedUser);

    if (!matched) {
      setErrorMsg('ไม่พบชื่อผู้ใช้งานนี้ในระบบ กรุณาตรวจสอบอีกครั้ง');
      return;
    }
    if (matched.status === 'suspended') {
      setErrorMsg('บัญชีผู้ใช้งานนี้ถูกระงับการใช้งานชั่วคราว กรุณาติดต่อผู้ดูแลระบบ (Admin)');
      return;
    }
    if (matched.password !== password) {
      setErrorMsg('รหัสผ่านไม่ถูกต้อง (บัญชีหลักติดระบบคือ Admin / รหัสผ่าน: 123456)');
      return;
    }

    onLoginSuccess(matched);
    setUsername('');
    setPassword('');
  };

  const handleQuickSwitch = (user: AppUser) => {
    if (user.status === 'suspended') return;
    setErrorMsg(null);
    onLoginSuccess(user);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full overflow-hidden my-auto">
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
          {canClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              title="ปิดหน้าต่าง"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Left Column: Standard Username / Password Form */}
          <div className="md:col-span-5 flex flex-col justify-between border-b md:border-b-0 md:border-r border-slate-200 pb-5 md:pb-0 md:pr-6">
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
                    placeholder="รหัสมาสเตอร์: 123456"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-sm cursor-pointer active:scale-98"
              >
                <LogIn className="w-4 h-4" />
                <span>เข้าสู่ระบบ</span>
              </button>
            </form>

            <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-600 space-y-1 bg-amber-50/70 p-2.5 rounded-xl border border-amber-200">
              <div className="font-bold text-amber-900">👑 บัญชีหลักมาสเตอร์ (ติดมากับระบบถาวร):</div>
              <div>• ชื่อผู้ใช้: <code className="font-mono font-bold bg-white px-1.5 py-0.5 rounded border border-amber-300">Admin</code></div>
              <div>• รหัสผ่าน: <code className="font-mono font-bold bg-white px-1.5 py-0.5 rounded border border-amber-300">123456</code></div>
            </div>
          </div>

          {/* Right Column: 1-Click Quick Role/User Switcher */}
          <div className="md:col-span-7 space-y-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>บัญชีผู้ใช้งานในระบบ ({activeUsers.length} บัญชี)</span>
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                คลิกเลือกบัญชีด้านล่างเพื่อเข้าใช้งานด่วน หรือเพิ่มพนักงานใหม่ได้ที่เมนู &ldquo;ผู้ใช้งาน & สิทธิ์&rdquo;
              </p>
            </div>

            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {activeUsers.map(u => {
                const roleInfo = rolePermissions[u.role];
                const isCurrent = currentUser?.id === u.id;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => handleQuickSwitch(u)}
                    className={`w-full text-left p-3 rounded-xl border transition flex items-start justify-between gap-3 cursor-pointer ${
                      isCurrent
                        ? 'bg-blue-50/80 border-blue-400 ring-2 ring-blue-100'
                        : 'bg-white hover:bg-slate-50 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-900">{u.fullName}</span>
                        {u.isSystemMaster && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                            👑 MASTER SYSTEM
                          </span>
                        )}
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${roleInfo?.badgeColor || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                          {roleInfo?.label || u.role}
                        </span>
                        {isCurrent && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3" /> กำลังใช้งาน
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-600 flex items-center gap-2 flex-wrap">
                        <span>Username: <strong className="font-mono">{u.username}</strong></span>
                        <span>•</span>
                        <span>รหัส: <strong className="font-mono">{u.password}</strong></span>
                        <span>•</span>
                        <span>{u.position}</span>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {roleInfo?.description}
                      </div>
                      {u.assignedProjects && u.assignedProjects.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap pt-0.5">
                          <Building2 className="w-3 h-3 text-emerald-600" />
                          <span className="text-[10px] font-semibold text-emerald-700">
                            เฉพาะโครงการ: {u.assignedProjects.join(', ')}
                          </span>
                        </div>
                      )}
                    </div>

                    <span className="shrink-0 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-semibold hover:bg-blue-600 transition">
                      เลือกใช้
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
