import React, { useState } from 'react';
import { KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';

interface FirstPasswordChangeModalProps {
  onChanged: () => void;
  onSkipped: () => void;
}

export const FirstPasswordChangeModal: React.FC<FirstPasswordChangeModalProps> = ({
  onChanged,
  onSkipped
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');

    if (newPassword.length < 12) {
      setErrorMessage('รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 12 ตัวอักษร');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage('ยืนยันรหัสผ่านใหม่ไม่ตรงกัน');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/auth/password/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        setErrorMessage(result.error || 'เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาลองใหม่');
        return;
      }
      onChanged();
    } catch (error) {
      console.error('[Auth] Password change request failed:', error);
      setErrorMessage('เชื่อมต่อระบบไม่ได้ กรุณาลองใหม่');
    } finally {
      setIsSubmitting(false);
    }
  };

  const skipForThisSession = async () => {
    setErrorMessage('');
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/auth/password/skip-first-change', { method: 'POST' });
      const result = await response.json();
      if (!response.ok || !result.success) {
        setErrorMessage(result.error || 'ข้ามการเปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาลองใหม่');
        return;
      }
      onSkipped();
    } catch (error) {
      console.error('[Auth] Skip password change request failed:', error);
      setErrorMessage('เชื่อมต่อระบบไม่ได้ กรุณาลองใหม่');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-xs">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-password-change-title"
        className="my-auto w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-slate-800 bg-slate-900 px-6 py-5 text-white">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-500/20 text-blue-200">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <h2 id="first-password-change-title" className="text-base font-bold">
              ตั้งรหัสผ่านใหม่
            </h2>
            <p className="mt-0.5 text-xs text-slate-300">เพื่อความปลอดภัยของบัญชีผู้ใช้งาน</p>
          </div>
        </div>

        <form onSubmit={changePassword} className="space-y-4 p-6">
          <p className="text-sm leading-6 text-slate-600">
            เปลี่ยนรหัสผ่านตอนนี้ได้ หรือข้ามไว้ก่อน ระบบจะแจ้งอีกครั้งเมื่อเข้าสู่ระบบครั้งถัดไปจนกว่าจะเปลี่ยนสำเร็จ
          </p>

          {errorMessage && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              {errorMessage}
            </div>
          )}

          <div className="space-y-3">
            <label className="block text-sm font-semibold text-slate-700">
              รหัสผ่านปัจจุบัน
              <span className="relative mt-1 block">
                <LockKeyhole className="absolute left-3 top-3 h-4 w-4 text-slate-400" aria-hidden="true" />
                <input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={event => setCurrentPassword(event.target.value)}
                  maxLength={1024}
                  autoFocus
                  required
                  className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                />
              </span>
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              รหัสผ่านใหม่
              <span className="relative mt-1 block">
                <KeyRound className="absolute left-3 top-3 h-4 w-4 text-slate-400" aria-hidden="true" />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={event => setNewPassword(event.target.value)}
                  minLength={12}
                  maxLength={1024}
                  required
                  aria-describedby="new-password-guidance"
                  className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                />
              </span>
              <span id="new-password-guidance" className="mt-1 block text-xs font-normal text-slate-500">
                ใช้อย่างน้อย 12 ตัวอักษร
              </span>
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              ยืนยันรหัสผ่านใหม่
              <span className="relative mt-1 block">
                <KeyRound className="absolute left-3 top-3 h-4 w-4 text-slate-400" aria-hidden="true" />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={event => setConfirmPassword(event.target.value)}
                  maxLength={1024}
                  required
                  className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                />
              </span>
            </label>
          </div>

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row">
            <button
              type="button"
              onClick={() => void skipForThisSession()}
              disabled={isSubmitting}
              className="min-h-11 flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              ข้ามครั้งนี้
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-11 flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'กำลังบันทึก...' : 'เปลี่ยนรหัสผ่าน'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
