import React, { useState, useMemo } from 'react';
import {
  AppUser,
  UserRole,
  RolePermissions,
  ProjectRecord,
  OrderRecord,
  PurchaseOrder
} from '../types';
import { DEFAULT_ROLE_PERMISSIONS } from '../utils/systemConfig';
import {
  Users,
  ShieldCheck,
  UserPlus,
  Edit3,
  Ban,
  CheckCircle2,
  RefreshCw,
  LogIn,
  KeyRound,
  Building2,
  Lock,
  Unlock,
  X,
  RotateCcw
} from 'lucide-react';

interface UsersRolesViewProps {
  users: AppUser[];
  currentUser: AppUser;
  rolePermissions: Record<UserRole, RolePermissions>;
  projects: ProjectRecord[];
  orders: OrderRecord[];
  pos: PurchaseOrder[];
  onSaveUser: (user: AppUser, isNew: boolean) => void;
  onToggleUserStatus: (userId: string) => void;
  onSwitchCurrentUser: (user: AppUser) => void;
  onUpdateRolePermissions: (updated: Record<UserRole, RolePermissions>) => void;
  showToast: (msg: string, type?: 'success' | 'info') => void;
}

const ALL_MENU_TABS: { id: string; label: string; group: string }[] = [
  { id: 'line_inbox', label: '💬 กล่องพักบิลจาก LINE OA', group: 'เอกสาร & ชนบิล' },
  { id: 'orders', label: '📦 ใบส่งของ / ใบส่งสินค้า (DO)', group: 'เอกสาร & ชนบิล' },
  { id: 'pos', label: '📝 ใบสั่งซื้อ (PO)', group: 'เอกสาร & ชนบิล' },
  { id: 'dest_wb', label: '⚖️ ตั๋วชั่งปลายทาง', group: 'เอกสาร & ชนบิล' },
  { id: 'tax_inv', label: '🧾 ใบเสร็จ/กำกับภาษี', group: 'เอกสาร & ชนบิล' },
  { id: 'billing', label: '📋 รับวางบิล (Express RR)', group: 'เอกสาร & ชนบิล' },
  { id: 'analytics', label: '📊 วิเคราะห์ & การเงิน', group: 'รายงาน & การเงิน' },
  { id: 'reports', label: '🖨️ ออกรายงาน Excel / PDF', group: 'รายงาน & การเงิน' },
  { id: 'stores', label: '🏪 ทะเบียนร้านค้า', group: 'ข้อมูลหลัก (Master)' },
  { id: 'projects', label: '🏗️ ทะเบียนโครงการ', group: 'ข้อมูลหลัก (Master)' },
  { id: 'users', label: '👥 ผู้ใช้งาน & สิทธิ์ (Users & Roles)', group: 'ผู้ดูแลระบบ (Admin)' },
  { id: 'settings', label: '⚙️ ตั้งค่าระบบ & สำรองข้อมูล', group: 'ผู้ดูแลระบบ (Admin)' }
];

const ACTION_PERMISSION_KEYS: {
  key: keyof Pick<
    RolePermissions,
    | 'canCreateOrder'
    | 'canEditOrder'
    | 'canDeleteOrder'
    | 'canViewFinancials'
    | 'canManagePO'
    | 'canExportReport'
    | 'canManageUsers'
    | 'canManageSettings'
  >;
  label: string;
  desc: string;
}[] = [
  {
    key: 'canCreateOrder',
    label: 'สแกนบิล AI / เพิ่มบิลใหม่',
    desc: 'อนุญาตให้กดปุ่มสแกนบิลด้วย AI และคีย์เพิ่มบิลใหม่เข้าระบบ'
  },
  {
    key: 'canEditOrder',
    label: 'แก้ไขข้อมูลบิล / ชนบิล',
    desc: 'อนุญาตให้เปิดแก้ไขข้อมูลในบิล ยืนยันบิลจากกล่องพัก LINE และชนบิล'
  },
  {
    key: 'canDeleteOrder',
    label: 'ลบบิล / ลบรายการเอกสาร',
    desc: 'อนุญาตให้ลบแถวบิลออกจากตารางหลัก 39 คอลัมน์ หรือลบออกจากกล่องพัก'
  },
  {
    key: 'canViewFinancials',
    label: 'ดูและแก้ไขราคา / การชำระเงิน (โซน 5–6)',
    desc: 'อนุญาตให้เห็นราคาต่อหน่วย ยอดเงินรวม และบันทึกยอดจ่ายชำระหนี้'
  },
  {
    key: 'canManagePO',
    label: 'เปิด / แก้ไข / อนุมัติใบสั่งซื้อ (PO)',
    desc: 'อนุญาตให้สร้างใบสั่งซื้อใหม่ แก้ไขรายการ PO และผูก/ยกเลิกการชนบิล PO'
  },
  {
    key: 'canExportReport',
    label: 'ออกรายงาน Excel / พิมพ์รายงาน PDF',
    desc: 'อนุญาตให้ดาวน์โหลดไฟล์ Excel และพิมพ์รายงานสรุป PDF'
  },
  {
    key: 'canManageUsers',
    label: 'จัดการผู้ใช้งานและกำหนดสิทธิ์',
    desc: 'อนุญาตให้เพิ่ม/แก้ไข/ระงับผู้ใช้ และปรับตารางสิทธิ์ Role & Permission'
  },
  {
    key: 'canManageSettings',
    label: 'ตั้งค่าระบบ & สำรอง/กู้คืนข้อมูล',
    desc: 'อนุญาตให้แก้ไขข้อมูลบริษัท เกณฑ์แจ้งเตือน และสำรอง/กู้คืนไฟล์ฐานข้อมูล'
  }
];

export const UsersRolesView: React.FC<UsersRolesViewProps> = ({
  users,
  currentUser,
  rolePermissions,
  projects,
  orders,
  pos,
  onSaveUser,
  onToggleUserStatus,
  onSwitchCurrentUser,
  onUpdateRolePermissions,
  showToast
}) => {
  const [subTab, setSubTab] = useState<'users' | 'permissions'>('users');
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);

  // User Form State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [position, setPosition] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('user');
  const [assignedProjects, setAssignedProjects] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  // Collect all unique project names across system
  const allProjectNames = useMemo(() => {
    const set = new Set<string>();
    projects.forEach(p => { if (p.name?.trim()) set.add(p.name.trim()); });
    orders.forEach(o => { if (o.col2?.trim()) set.add(o.col2.trim()); });
    pos.forEach(p => { if (p.projectId?.trim()) set.add(p.projectId.trim()); });
    return Array.from(set);
  }, [projects, orders, pos]);

  const openAddUserModal = () => {
    setEditingUser(null);
    setUsername('');
    setPassword('123456');
    setFullName('');
    setPosition('เจ้าหน้าที่ตรวจรับบิลหน้างาน');
    setPhone('');
    setRole('user');
    setAssignedProjects([]);
    setFormError(null);
    setIsUserModalOpen(true);
  };

  const openEditUserModal = (u: AppUser) => {
    setEditingUser(u);
    setUsername(u.username);
    setPassword(u.password);
    setFullName(u.fullName);
    setPosition(u.position);
    setPhone(u.phone || '');
    setRole(u.role);
    setAssignedProjects(u.assignedProjects || []);
    setFormError(null);
    setIsUserModalOpen(true);
  };

  const handleUserSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const isMaster = Boolean(editingUser?.isSystemMaster);
    const cleanUsername = isMaster ? 'Admin' : username.trim();
    if (!cleanUsername || !fullName.trim() || !password.trim()) {
      setFormError('กรุณากรอก Username, รหัสผ่าน และชื่อ-นามสกุลให้ครบถ้วน');
      return;
    }

    const duplicateUsername = users.find(
      u => u.username.trim().toLowerCase() === cleanUsername.toLowerCase() && u.id !== editingUser?.id
    );
    if (duplicateUsername) {
      setFormError(`ชื่อผู้ใช้งาน "${cleanUsername}" มีอยู่ในระบบแล้ว กรุณาใช้ชื่ออื่น`);
      return;
    }

    const payload: AppUser = {
      id: editingUser ? editingUser.id : `USR-${Date.now().toString().slice(-5)}`,
      username: cleanUsername,
      password: password.trim(),
      fullName: fullName.trim(),
      position: position.trim() || 'เจ้าหน้าที่',
      phone: phone.trim(),
      role: isMaster ? 'admin' : role,
      assignedProjects: isMaster ? [] : assignedProjects,
      status: isMaster ? 'active' : (editingUser ? editingUser.status : 'active'),
      isSystemMaster: isMaster,
      createdAt: editingUser ? editingUser.createdAt : new Date().toISOString(),
      lastLoginAt: editingUser?.lastLoginAt
    };

    onSaveUser(payload, !editingUser);
    setIsUserModalOpen(false);
  };

  const toggleProjectAssignment = (projName: string) => {
    setAssignedProjects(prev =>
      prev.includes(projName) ? prev.filter(p => p !== projName) : [...prev, projName]
    );
  };

  const handleToggleMenuPermission = (targetRole: UserRole, tabId: string) => {
    // Keep 'users' and 'settings' always enabled for admin so admin never locks themselves out
    if (targetRole === 'admin' && (tabId === 'users' || tabId === 'settings')) {
      showToast('ไม่สามารถปิดสิทธิ์เมนูผู้ดูแลระบบของ Admin ได้ เพื่อป้องกันการล็อกตัวเองออกจากระบบ', 'info');
      return;
    }
    const current = rolePermissions[targetRole];
    const exists = current.allowedTabs.includes(tabId);
    const nextTabs = exists
      ? current.allowedTabs.filter(t => t !== tabId)
      : [...current.allowedTabs, tabId];

    onUpdateRolePermissions({
      ...rolePermissions,
      [targetRole]: {
        ...current,
        allowedTabs: nextTabs
      }
    });
  };

  const handleToggleActionPermission = (
    targetRole: UserRole,
    key: typeof ACTION_PERMISSION_KEYS[number]['key']
  ) => {
    if (targetRole === 'admin' && (key === 'canManageUsers' || key === 'canManageSettings')) {
      showToast('Admin ต้องมีสิทธิ์จัดการผู้ใช้และตั้งค่าระบบเสมอ', 'info');
      return;
    }
    const current = rolePermissions[targetRole];
    onUpdateRolePermissions({
      ...rolePermissions,
      [targetRole]: {
        ...current,
        [key]: !current[key]
      }
    });
  };

  const handleResetDefaultPermissions = () => {
    onUpdateRolePermissions(DEFAULT_ROLE_PERMISSIONS);
    showToast('คืนค่าตารางกำหนดสิทธิ์ (Role & Permission) เป็นค่ามาตรฐานเรียบร้อยแล้ว');
  };

  return (
    <div className="space-y-4">
      {/* Top Sub-Navigation & Summary Banner */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              จัดการผู้ใช้งาน & กำหนดสิทธิ์การเข้าถึง (Users, Roles & Permissions)
            </h2>
            <p className="text-xs text-slate-500">
              แยกบัญชีผู้ใช้งาน กำหนดสิทธิ์ Admin / Manager / User รายเมนู และสลับบัญชีทดสอบได้ในคลิกเดียว
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => setSubTab('users')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              subTab === 'users'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4 text-indigo-600" />
            <span>1. รายชื่อผู้ใช้งาน ({users.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('permissions')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              subTab === 'permissions'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>2. ตารางกำหนดสิทธิ์ (Role & Permission Matrix)</span>
          </button>
        </div>
      </div>

      {/* SUB-TAB 1: USER MANAGEMENT */}
      {subTab === 'users' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                ทะเบียนผู้ใช้งานในระบบ ({users.filter(u => u.status === 'active').length} ใช้งานปกติ / {users.filter(u => u.status === 'suspended').length} ระงับชั่วคราว)
              </h3>
              <p className="text-xs text-slate-500">
                ใช้การ "ระงับการใช้งาน" แทนการลบถาวร เพื่อรักษาชื่อผู้บันทึกในประวัติบิลเก่า (Audit Trail)
              </p>
            </div>
            <button
              type="button"
              onClick={openAddUserModal}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>เพิ่มผู้ใช้งานใหม่</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100/80 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase">
                  <th className="py-3 px-4">#</th>
                  <th className="py-3 px-4">ชื่อ-นามสกุล / ตำแหน่ง</th>
                  <th className="py-3 px-4">Username / รหัสผ่าน</th>
                  <th className="py-3 px-4">บทบาท (Role)</th>
                  <th className="py-3 px-4">ขอบเขตโครงการที่ดูแล</th>
                  <th className="py-3 px-4 text-center">ประวัติบันทึกบิล</th>
                  <th className="py-3 px-4 text-center">สถานะบัญชี</th>
                  <th className="py-3 px-4 text-right">จัดการ / ทดสอบสลับสิทธิ์</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {users.map((u, idx) => {
                  const roleInfo = rolePermissions[u.role];
                  const isCurrent = currentUser.id === u.id;
                  const userOrderCount = orders.filter(
                    o => o.createdBy === u.fullName || o.updatedBy === u.fullName || o.col9 === u.fullName
                  ).length;

                  return (
                    <tr
                      key={u.id}
                      className={`transition ${
                        u.status === 'suspended'
                          ? 'bg-slate-50/80 opacity-60'
                          : isCurrent
                          ? 'bg-blue-50/40'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-3.5 px-4 font-mono text-slate-500">{idx + 1}</td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900">{u.fullName}</span>
                          {u.isSystemMaster && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                              👑 MASTER SYSTEM (บัญชีหลักติดระบบ)
                            </span>
                          )}
                          {isCurrent && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200">
                              กำลังล็อกอินอยู่
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {u.position} {u.phone ? `• โทร ${u.phone}` : ''}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono">
                        <div className="font-bold text-slate-800">{u.username}</div>
                        <div className="text-[10px] text-slate-400">รหัส: {u.password}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold border ${roleInfo?.badgeColor || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                          {roleInfo?.label || u.role}
                        </span>
                        <div className="text-[10px] text-slate-500 mt-1">
                          เข้าได้ {roleInfo?.allowedTabs.length || 0} เมนู
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        {!u.assignedProjects || u.assignedProjects.length === 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-medium">
                            <Building2 className="w-3 h-3 text-slate-500" />
                            ทุกโครงการในระบบ
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {u.assignedProjects.map(proj => (
                              <span
                                key={proj}
                                className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-semibold"
                              >
                                {proj}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-700">
                        {userOrderCount} รายการ
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {u.status === 'active' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" /> ใช้งานปกติ
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            <Ban className="w-3 h-3" /> ระงับชั่วคราว
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {u.status === 'active' && !isCurrent && (
                            <button
                              type="button"
                              onClick={() => onSwitchCurrentUser(u)}
                              className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold transition flex items-center gap-1 cursor-pointer"
                              title="สลับไปใช้งานในชื่อบัญชีนี้ทันที เพื่อทดสอบมุมมองและสิทธิ์"
                            >
                              <LogIn className="w-3.5 h-3.5" />
                              <span>สลับใช้</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openEditUserModal(u)}
                            className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-[11px] font-semibold transition flex items-center gap-1 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>แก้ไข</span>
                          </button>
                          {u.isSystemMaster ? (
                            <span
                              className="px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-bold flex items-center gap-1"
                              title="บัญชีมาสเตอร์หลักติดกับระบบถาวร ไม่สามารถระงับหรือลบได้"
                            >
                              <Lock className="w-3.5 h-3.5" />
                              <span>ติดระบบถาวร</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onToggleUserStatus(u.id)}
                              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition flex items-center gap-1 cursor-pointer ${
                                u.status === 'active'
                                  ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
                                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                              }`}
                            >
                              {u.status === 'active' ? (
                                <>
                                  <Lock className="w-3.5 h-3.5" />
                                  <span>ระงับ</span>
                                </>
                              ) : (
                                <>
                                  <Unlock className="w-3.5 h-3.5" />
                                  <span>เปิดใช้</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: ROLE & PERMISSION MATRIX */}
      {subTab === 'permissions' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  ส่วนที่ 1: กำหนดสิทธิ์การเข้าถึงเมนูซ้าย (Menu Access Matrix)
                </h3>
                <p className="text-xs text-slate-500">
                  คลิกเปิด/ปิดเมนูที่ต้องการให้แต่ละบทบาท (`Admin`, `Manager`, `User`) มองเห็นและเข้าใช้งานได้
                </p>
              </div>
              <button
                type="button"
                onClick={handleResetDefaultPermissions}
                className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>คืนค่าสิทธิ์มาตรฐาน</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100/80 border-b border-slate-200 text-xs font-bold text-slate-700">
                    <th className="py-3 px-4">ชื่อเมนูในระบบ</th>
                    <th className="py-3 px-4">หมวดหมู่</th>
                    <th className="py-3 px-4 text-center">ผู้ดูแลระบบ (Admin)</th>
                    <th className="py-3 px-4 text-center">ผู้จัดการ / บัญชี (Manager)</th>
                    <th className="py-3 px-4 text-center">เจ้าหน้าที่หน้างาน (User)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {ALL_MENU_TABS.map(tab => (
                    <tr key={tab.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-bold text-slate-800">{tab.label}</td>
                      <td className="py-3 px-4 text-slate-500">{tab.group}</td>
                      {(['admin', 'manager', 'user'] as UserRole[]).map(r => {
                        const allowed = rolePermissions[r]?.allowedTabs.includes(tab.id);
                        return (
                          <td key={r} className="py-3 px-4 text-center">
                            <input
                              type="checkbox"
                              checked={Boolean(allowed)}
                              onChange={() => handleToggleMenuPermission(r, tab.id)}
                              className="w-4 h-4 accent-blue-600 rounded cursor-pointer"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action Permissions Matrix */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/60">
              <h3 className="text-sm font-bold text-slate-900">
                ส่วนที่ 2: กำหนดสิทธิ์การกระทำและการมองเห็นข้อมูลการเงิน (Action & Data Permissions)
              </h3>
              <p className="text-xs text-slate-500">
                กำหนดว่าใครสามารถเพิ่ม แก้ไข ลบบิล ดูราคา/ยอดเงิน (โซน 5–6) หรืออนุมัติ PO ได้บ้าง
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100/80 border-b border-slate-200 text-xs font-bold text-slate-700">
                    <th className="py-3 px-4">สิทธิ์การทำงาน (Action Permission)</th>
                    <th className="py-3 px-4">คำอธิบายผลลัพธ์</th>
                    <th className="py-3 px-4 text-center">ผู้ดูแลระบบ (Admin)</th>
                    <th className="py-3 px-4 text-center">ผู้จัดการ / บัญชี (Manager)</th>
                    <th className="py-3 px-4 text-center">เจ้าหน้าที่หน้างาน (User)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {ACTION_PERMISSION_KEYS.map(perm => (
                    <tr key={perm.key} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-bold text-slate-800">{perm.label}</td>
                      <td className="py-3 px-4 text-slate-500">{perm.desc}</td>
                      {(['admin', 'manager', 'user'] as UserRole[]).map(r => {
                        const checked = Boolean(rolePermissions[r]?.[perm.key]);
                        return (
                          <td key={r} className="py-3 px-4 text-center">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleToggleActionPermission(r, perm.key)}
                              className="w-4 h-4 accent-emerald-600 rounded cursor-pointer"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ADD / EDIT USER MODAL */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden my-auto">
            <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <UserPlus className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-bold">
                  {editingUser ? `แก้ไขข้อมูลผู้ใช้: ${editingUser.fullName}` : 'เพิ่มผู้ใช้งานใหม่เข้าระบบ'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsUserModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUserSubmit} className="p-5 space-y-4 text-xs">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-medium">
                  {formError}
                </div>
              )}

              {editingUser?.isSystemMaster && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 font-medium">
                  👑 <strong>บัญชีมาสเตอร์หลักของระบบ (System Master Account)</strong>: ล็อกชื่อผู้ใช้เป็น <code className="font-mono font-bold">Admin</code> และสิทธิ์สูงสุดเสมอ (สามารถเปลี่ยนรหัสผ่านหรือชื่อที่แสดงได้)
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    ชื่อผู้ใช้งาน (Username) *
                  </label>
                  <input
                    type="text"
                    value={editingUser?.isSystemMaster ? 'Admin' : username}
                    onChange={e => setUsername(e.target.value)}
                    disabled={Boolean(editingUser?.isSystemMaster)}
                    placeholder="เช่น somchai01"
                    className={`w-full px-3 py-2 rounded-xl border border-slate-300 font-mono focus:border-indigo-600 outline-none ${
                      editingUser?.isSystemMaster ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''
                    }`}
                    required
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    รหัสผ่าน (Password) *
                  </label>
                  <div className="relative">
                    <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="เช่น 123456"
                      className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-300 font-mono focus:border-indigo-600 outline-none"
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    ชื่อ-นามสกุล / ชื่อที่แสดงในบิล *
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="เช่น ช่างเอก (หน้างานพระราม 3)"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-indigo-600 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    ตำแหน่งงาน
                  </label>
                  <input
                    type="text"
                    value={position}
                    onChange={e => setPosition(e.target.value)}
                    placeholder="เช่น เจ้าหน้าที่สโตร์หน้างาน"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-indigo-600 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    บทบาทและระดับสิทธิ์ (Role) *
                  </label>
                  <select
                    value={editingUser?.isSystemMaster ? 'admin' : role}
                    onChange={e => setRole(e.target.value as UserRole)}
                    disabled={Boolean(editingUser?.isSystemMaster)}
                    className={`w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold focus:border-indigo-600 outline-none ${
                      editingUser?.isSystemMaster ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''
                    }`}
                  >
                    <option value="admin">ผู้ดูแลระบบสูงสุด (Admin)</option>
                    <option value="manager">ผู้จัดการ / บัญชี (Manager)</option>
                    <option value="user">เจ้าหน้าที่หน้างาน (User / Staff)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    เบอร์โทรศัพท์ติดต่อ
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="เช่น 081-234-5678"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-indigo-600 outline-none"
                  />
                </div>
              </div>

              {/* Project Assignment */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700">
                    โครงการที่รับผิดชอบ (ไม่ติ๊ก = ดูแลได้ทุกโครงการ)
                  </label>
                  {assignedProjects.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setAssignedProjects([])}
                      className="text-[11px] text-indigo-600 hover:underline cursor-pointer"
                    >
                      ล้างตัวเลือก (ให้ดูแลทุกโครงการ)
                    </button>
                  )}
                </div>
                {allProjectNames.length === 0 ? (
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 text-[11px]">
                    ยังไม่มีโครงการในระบบ (สามารถเพิ่มโครงการได้ที่เมนู ทะเบียนโครงการ)
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 max-h-36 overflow-y-auto flex flex-wrap gap-2">
                    {allProjectNames.map(proj => {
                      const active = assignedProjects.includes(proj);
                      return (
                        <button
                          key={proj}
                          type="button"
                          onClick={() => toggleProjectAssignment(proj)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition cursor-pointer ${
                            active
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          {active ? '✓ ' : '+ '}
                          {proj}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-semibold hover:bg-slate-100 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-xs cursor-pointer"
                >
                  {editingUser ? 'บันทึกการแก้ไข' : 'เพิ่มผู้ใช้งาน'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
