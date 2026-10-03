/**
 * Google Drive Zero-Junk Storage Engine (PHASE 3)
 * Reference: /DATABASE_STORAGE_BLUEPRINT.md (Section 2 & 3)
 *
 * Authentication: Google Service Account (RS256 JWT signed with node:crypto)
 * -> No extra npm dependency required (uses Drive REST API v3 + OAuth2 token endpoint).
 *
 * Responsibilities:
 * 1. สร้าง/ค้นหาโฟลเดอร์ 5 โซนมาตรฐานใต้โฟลเดอร์หลัก BRTC_ERP_Storage
 * 2. สร้างโฟลเดอร์ประจำใบงานอัตโนมัติตามเลขที่เอกสาร (Sanitization: "/" -> "-")
 * 3. อัปโหลดรูปบิล/เอกสารแนบ (Base64) แล้วผูกเข้ากับโฟลเดอร์ที่ถูกต้อง
 * 4. Auto-Move ไฟล์เมื่อชนบิลสำเร็จ (03/04 -> 02) และย้ายกลับเมื่อกดยกเลิกการจับคู่
 * 5. Zero-Junk Cleanup: ลบไฟล์เก่าทันทีเมื่ออัปโหลดรูปใหม่/ลบรูป, และลบไฟล์+โฟลเดอร์ทันทีเมื่อลบเอกสาร
 */

import crypto from 'crypto';
import fs from 'fs';

export type DriveZoneKey = 'line_inbox' | 'po' | 'do' | 'dest_weighbridge' | 'tax_invoice';

/** 5 โซนมาตรฐานตามพิมพ์เขียว (ห้ามเปลี่ยนชื่อ เพราะระบบจะอ้างอิงชื่อนี้ในการค้นหาซ้ำ) */
export const DRIVE_ZONES: Record<DriveZoneKey, string> = {
  line_inbox: '00_กล่องพักบิล_LINE_รอตรวจรับ',
  po: '01_ใบสั่งซื้อ_PO',
  do: '02_ใบงานหลัก_DO_ครบชุด',
  dest_weighbridge: '03_ตั๋วชั่งปลายทาง_รอจับคู่DO',
  tax_invoice: '04_ใบเสร็จกำกับภาษี_เอกเทศ'
};

export const DRIVE_ZONE_LABELS: Record<DriveZoneKey, string> = {
  line_inbox: 'กล่องพักบิล LINE รอตรวจรับ',
  po: 'ใบสั่งซื้อ (PO)',
  do: 'ใบงานหลัก DO ครบชุด',
  dest_weighbridge: 'ตั๋วชั่งปลายทาง รอจับคู่ DO',
  tax_invoice: 'ใบเสร็จ/ใบกำกับภาษี'
};

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

export interface DriveConfig {
  serviceAccountJson: string;
  rootFolderId: string;
  isEnabled: boolean;
  shareReadLinks: boolean;
  purgeDeletedFiles: boolean;
  lastTestedAt?: string;
}

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedToken: { token: string; expiresAt: number; key: string } | null = null;
let cachedZoneFolders: { rootId: string; zones: Record<DriveZoneKey, string> } | null = null;

// ============================================================================
// CONFIGURATION (อ่านจากไฟล์ .drive_config.json และ/หรือ .env)
// ============================================================================

export function getDriveConfig(configPath: string): DriveConfig {
  let fileConfig: Partial<DriveConfig> = {};
  try {
    if (fs.existsSync(configPath)) {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (err) {
    console.warn('[Drive Config] Failed to read .drive_config.json', err);
  }

  const envJson = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  const rawJson = (fileConfig.serviceAccountJson || envJson || '').trim();

  return {
    // รองรับทั้ง JSON แบบ inline และ path ไปยังไฟล์ JSON ของ Service Account
    serviceAccountJson: rawJson.startsWith('{')
      ? rawJson
      : rawJson && fs.existsSync(rawJson)
      ? fs.readFileSync(rawJson, 'utf-8')
      : '',
    rootFolderId: (fileConfig.rootFolderId || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '').trim(),
    isEnabled: fileConfig.isEnabled !== undefined ? Boolean(fileConfig.isEnabled) : Boolean(rawJson),
    shareReadLinks:
      fileConfig.shareReadLinks !== undefined ? Boolean(fileConfig.shareReadLinks) : false,
    purgeDeletedFiles:
      fileConfig.purgeDeletedFiles !== undefined ? Boolean(fileConfig.purgeDeletedFiles) : true,
    lastTestedAt: fileConfig.lastTestedAt
  };
}

export function saveDriveConfig(configPath: string, patch: Partial<DriveConfig>): DriveConfig {
  const current = getDriveConfig(configPath);
  const merged: DriveConfig = { ...current, ...patch };
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf-8');
  cachedToken = null;
  cachedZoneFolders = null;
  return merged;
}

export function isDriveReady(cfg: DriveConfig): boolean {
  return Boolean(cfg.isEnabled && cfg.rootFolderId && parseServiceAccount(cfg.serviceAccountJson));
}

function parseServiceAccount(raw: string): ServiceAccountCredentials | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.client_email && parsed?.private_key) return parsed as ServiceAccountCredentials;
  } catch {
    /* invalid JSON */
  }
  return null;
}

// ============================================================================
// AUTHENTICATION: Service Account -> RS256 JWT -> OAuth2 Access Token
// ============================================================================

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildJwtAssertion(creds: ServiceAccountCredentials): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: creds.client_email,
    scope: DRIVE_SCOPE,
    aud: creds.token_uri || TOKEN_ENDPOINT,
    iat: issuedAt,
    exp: issuedAt + 3600
  };

  const signatureBase = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(payload)
  )}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signatureBase);
  const signature = signer.sign(creds.private_key.replace(/\\n/g, '\n'));
  return `${signatureBase}.${base64UrlEncode(signature)}`;
}

async function getAccessToken(cfg: DriveConfig): Promise<string> {
  const creds = parseServiceAccount(cfg.serviceAccountJson);
  if (!creds) throw new Error('ยังไม่ได้ตั้งค่า GOOGLE_SERVICE_ACCOUNT_JSON ให้ถูกต้อง');

  if (cachedToken && cachedToken.key === creds.client_email && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const resp = await fetch(creds.token_uri || TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: buildJwtAssertion(creds)
    }).toString()
  });

  const data: any = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.access_token) {
    throw new Error(`Google OAuth ล้มเหลว (${resp.status}): ${data?.error_description || data?.error || 'ไม่ทราบสาเหตุ'}`);
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 120) * 1000,
    key: creds.client_email
  };
  return cachedToken.token;
}

async function driveFetch(
  cfg: DriveConfig,
  url: string,
  init: { method?: string; body?: Buffer | string; headers?: Record<string, string> } = {}
): Promise<any> {
  const token = await getAccessToken(cfg);
  const resp = await fetch(url, {
    method: init.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {})
    },
    body: init.body as any
  });

  if (resp.status === 204) return {};
  const text = await resp.text();
  const data = text ? JSON.parse(text) : {};
  if (!resp.ok) {
    const message = data?.error?.message || data?.error_description || text || `HTTP ${resp.status}`;
    throw new Error(`Google Drive API ขัดข้อง: ${message}`);
  }
  return data;
}

// ============================================================================
// NAME SANITIZATION & PATH BUILDERS
// ============================================================================

/**
 * Sanitization Rule (Blueprint Section 2):
 * เครื่องหมายทับ "/" และอักขระพิเศษ ถูกแปลงเป็นขีดกลาง "-" อัตโนมัติ
 * (เช่น 02/0045 -> 02-0045) และตัดความยาวไม่เกิน 120 ตัวอักษร
 */
export function sanitizeDriveName(raw?: string | null): string {
  const cleaned = (raw || '')
    .toString()
    .replace(/[\\/:*?"<>|#%{}~&]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/-{2,}/g, '-')
    .slice(0, 120);
  return cleaned || 'ไม่ระบุเอกสาร';
}

/** ชื่อโฟลเดอร์ประจำใบงาน: นำหน้าด้วยเลข TR เสมอ เพื่อกันชื่อซ้ำข้ามร้านค้า */
export function buildJobFolderName(params: { trNo?: string | null; docNo?: string | null }): string {
  const tr = sanitizeDriveName(params.trNo || 'TR-ไม่ระบุ');
  const doc = sanitizeDriveName(params.docNo || '');
  return doc ? `${tr}_${doc}` : tr;
}

/** ชื่อไฟล์รูปเอกสารตามลำดับชุด: 1_DO_xxx.jpg / 2_WB_xxx.jpg / 3_TAX_xxx.jpg */
export function buildDocumentFileName(params: {
  index: number;
  docType?: string | null;
  docNo?: string | null;
  extension?: string;
}): string {
  const prefix =
    params.docType === 'dest_weighbridge'
      ? 'WB'
      : params.docType === 'tax_invoice'
      ? 'TAX'
      : params.docType === 'purchase_order'
      ? 'PO'
      : 'DO';
  const docNo = sanitizeDriveName(params.docNo || 'ไม่ระบุ');
  const ext = (params.extension || 'jpg').replace(/^\./, '').toLowerCase();
  return `${params.index}_${prefix}_${docNo}.${ext}`;
}

/** แปลง docType ของระบบ -> โซนบน Google Drive */
export function zoneForDocType(docType?: string | null): DriveZoneKey {
  switch (docType) {
    case 'dest_weighbridge':
      return 'dest_weighbridge';
    case 'tax_invoice':
      return 'tax_invoice';
    case 'purchase_order':
      return 'po';
    case 'delivery_order':
    default:
      return 'do';
  }
}

// ============================================================================
// CORE DRIVE OPERATIONS
// ============================================================================

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function findFolderByName(
  cfg: DriveConfig,
  parentId: string,
  name: string
): Promise<string | null> {
  const q = `name = '${escapeDriveQuery(name)}' and '${escapeDriveQuery(
    parentId
  )}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const data = await driveFetch(
    cfg,
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive&supportsAllDrives=true&pageSize=10`
  );
  return data?.files?.[0]?.id || null;
}

export async function createFolder(cfg: DriveConfig, name: string, parentId: string): Promise<string> {
  const data = await driveFetch(cfg, `${DRIVE_API}/files?supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    })
  });
  return data.id;
}

export async function ensureFolder(cfg: DriveConfig, parentId: string, name: string): Promise<string> {
  const existing = await findFolderByName(cfg, parentId, name);
  return existing || createFolder(cfg, name, parentId);
}

/** สร้าง/ค้นหาโฟลเดอร์ทั้ง 5 โซนใต้โฟลเดอร์หลัก (มี cache ในหน่วยความจำ) */
export async function ensureZoneFolders(cfg: DriveConfig): Promise<Record<DriveZoneKey, string>> {
  if (cachedZoneFolders && cachedZoneFolders.rootId === cfg.rootFolderId) {
    return cachedZoneFolders.zones;
  }

  const zones = {} as Record<DriveZoneKey, string>;
  for (const key of Object.keys(DRIVE_ZONES) as DriveZoneKey[]) {
    zones[key] = await ensureFolder(cfg, cfg.rootFolderId, DRIVE_ZONES[key]);
  }
  cachedZoneFolders = { rootId: cfg.rootFolderId, zones };
  return zones;
}

export function invalidateDriveCache(): void {
  cachedToken = null;
  cachedZoneFolders = null;
}

export async function getZoneFolder(cfg: DriveConfig, zone: DriveZoneKey): Promise<string> {
  const zones = await ensureZoneFolders(cfg);
  const folderId = zones[zone];
  if (!folderId) throw new Error(`ไม่พบโฟลเดอร์โซน ${DRIVE_ZONES[zone]}`);
  return folderId;
}

/** ดึงไฟล์เข้า Drive (Base64 Data URL หรือ Base64 ดิบ) */
export async function uploadBase64File(params: {
  cfg: DriveConfig;
  fileName: string;
  base64: string;
  mimeType?: string;
  parentId: string;
  shareReadLink?: boolean;
}): Promise<{ id: string; name: string; webViewLink?: string }> {
  const { cfg, fileName, base64, parentId } = params;
  const mimeType = params.mimeType || 'image/jpeg';

  const rawBase64 = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  const binary = Buffer.from(rawBase64, 'base64');
  if (binary.length === 0) throw new Error('ไฟล์รูปว่างเปล่า (ไม่พบข้อมูล Base64)');

  const boundary = `brtc_${crypto.randomBytes(12).toString('hex')}`;
  const metadata = JSON.stringify({
    name: fileName,
    mimeType,
    parents: [parentId]
  });

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    ),
    binary,
    Buffer.from(`\r\n--${boundary}--`)
  ]);

  const file = await driveFetch(
    cfg,
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink`,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length)
      },
      body
    }
  );

  if (params.shareReadLink) {
    await makeFileReadable(cfg, file.id).catch(err =>
      console.warn('[Drive] Share read link skipped:', err?.message || err)
    );
  }

  return file;
}

/**
 * เปิดสิทธิ์อ่านไฟล์แบบ "Anyone with the link" (ต้องเปิดใช้งานใน config เท่านั้น)
 * ใช้สำหรับให้พนักงานเปิดดูรูปบิลจากเบราว์เซอร์ได้โดยไม่ต้องมีบัญชี Google
 */
export async function makeFileReadable(cfg: DriveConfig, fileId: string): Promise<void> {
  await driveFetch(cfg, `${DRIVE_API}/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' })
  });
}

/** Auto-Move: ย้ายไฟล์ไปยังโฟลเดอร์ใหม่ (พร้อมเปลี่ยนชื่อไฟล์ได้) */
export async function moveFile(params: {
  cfg: DriveConfig;
  fileId: string;
  targetFolderId: string;
  newName?: string;
}): Promise<{ id: string; name: string }> {
  const { cfg, fileId, targetFolderId, newName } = params;

  const meta = await driveFetch(cfg, `${DRIVE_API}/files/${fileId}?fields=id,parents&supportsAllDrives=true`);
  const previousParents = Array.isArray(meta?.parents) ? meta.parents : [];

  const body: Record<string, unknown> = { addParents: targetFolderId, removeParents: previousParents.join(',') };
  if (newName) body.name = newName;

  return driveFetch(
    cfg,
    `${DRIVE_API}/files/${fileId}?fields=id,name&supportsAllDrives=true&addParents=${encodeURIComponent(
      targetFolderId
    )}&removeParents=${encodeURIComponent(previousParents.join(','))}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newName ? { name: newName } : {})
    }
  );
}

/** เปลี่ยนชื่อโฟลเดอร์เดิม (ใช้เมื่อแก้ไขเลขที่เอกสาร โดยไม่ต้องย้ายไฟล์ใด ๆ) */
export async function renameFolder(params: {
  cfg: DriveConfig;
  folderId: string;
  newName: string;
}): Promise<{ id: string; name: string }> {
  const { cfg, folderId, newName } = params;
  return driveFetch(
    cfg,
    `${DRIVE_API}/files/${folderId}?fields=id,name&supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    }
  );
}

export async function listFolderFiles(
  cfg: DriveConfig,
  folderId: string
): Promise<Array<{ id: string; name: string; mimeType: string }>> {
  const q = `'${escapeDriveQuery(folderId)}' in parents and trashed = false`;
  const data = await driveFetch(
    cfg,
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&spaces=drive&supportsAllDrives=true&pageSize=200&orderBy=name`
  );
  return data?.files || [];
}

/**
 * Zero-Junk Cleanup: สั่งลบไฟล์ถาวร (ไม่ทิ้งไว้ในถังขยะของ Google Drive)
 * - ครั้งที่ 1: DELETE -> เลื่อนเข้าถังขยะ
 * - ครั้งที่ 2: DELETE ซ้ำ -> ลบถาวร 100% (ไม่เหลือไฟล์ขยะตกค้าง)
 */
export async function deleteFile(cfg: DriveConfig, fileId: string, purge = true): Promise<boolean> {
  if (!fileId) return false;
  try {
    await driveFetch(cfg, `${DRIVE_API}/files/${fileId}?supportsAllDrives=true`, { method: 'DELETE' });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('not found') || msg.includes('404')) return false;
    throw err;
  }

  if (purge) {
    try {
      await driveFetch(cfg, `${DRIVE_API}/files/${fileId}?supportsAllDrives=true`, { method: 'DELETE' });
    } catch {
      /* ลบถาวรไม่สำเร็จ (เช่น ไฟล์ถูกลบไปแล้ว) ถือว่าสำเร็จ */
    }
  }
  return true;
}

/** ลบหลายไฟล์พร้อมกัน โดยไม่หยุดกลางคันเมื่อไฟล์ใดไฟล์หนึ่งหายไปแล้ว */
export async function deleteFiles(
  cfg: DriveConfig,
  fileIds: Array<string | null | undefined>,
  purge = true
): Promise<{ deleted: string[]; failed: Array<{ fileId: string; reason: string }> }> {
  const ids = Array.from(new Set(fileIds.filter((id): id is string => Boolean(id))));
  const deleted: string[] = [];
  const failed: Array<{ fileId: string; reason: string }> = [];

  for (const fileId of ids) {
    try {
      if (await deleteFile(cfg, fileId, purge)) deleted.push(fileId);
    } catch (err: any) {
      failed.push({ fileId, reason: err?.message || 'ลบไฟล์ไม่สำเร็จ' });
    }
  }
  return { deleted, failed };
}

/** ลบโฟลเดอร์พร้อมไฟล์ทั้งหมดข้างใน (Zero-Junk เมื่อลบเอกสารออกจากระบบ) */
export async function deleteFolderRecursive(
  cfg: DriveConfig,
  folderId: string,
  purge = true
): Promise<boolean> {
  if (!folderId) return false;
  try {
    return await deleteFile(cfg, folderId, purge);
  } catch (err: any) {
    console.warn('[Drive] Failed to delete folder:', err?.message || err);
    return false;
  }
}

export async function getFileMeta(
  cfg: DriveConfig,
  fileId: string
): Promise<{ id: string; name: string; parents: string[]; mimeType: string } | null> {
  try {
    return await driveFetch(
      cfg,
      `${DRIVE_API}/files/${fileId}?fields=id,name,parents,mimeType&supportsAllDrives=true`
    );
  } catch {
    return null;
  }
}

/** ทดสอบการเชื่อมต่อ: ตรวจสิทธิ์อ่านโฟลเดอร์หลัก + ดึงชื่อโฟลเดอร์กลับมา */
export async function testDriveConnection(cfg: DriveConfig): Promise<{
  ok: boolean;
  serviceAccountEmail?: string;
  rootFolderName?: string;
  error?: string;
}> {
  try {
    const creds = parseServiceAccount(cfg.serviceAccountJson);
    if (!creds) {
      return { ok: false, error: 'ยังไม่ได้ตั้งค่า Service Account JSON (ต้องมี client_email และ private_key)' };
    }
    if (!cfg.rootFolderId) {
      return { ok: false, error: 'ยังไม่ได้ตั้งค่า GOOGLE_DRIVE_ROOT_FOLDER_ID (รหัสโฟลเดอร์หลักบน Google Drive)' };
    }

    const meta = await driveFetch(
      cfg,
      `${DRIVE_API}/files/${cfg.rootFolderId}?fields=id,name,mimeType&supportsAllDrives=true`
    );
    return {
      ok: true,
      serviceAccountEmail: creds.client_email,
      rootFolderName: meta?.name
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'เชื่อมต่อ Google Drive ไม่สำเร็จ' };
  }
}

/**
 * สร้างโฟลเดอร์ 5 โซน + สรุปโครงสร้างที่ระบบจะใช้งาน
 */
export async function provisionDriveStructure(cfg: DriveConfig): Promise<{
  root: string;
  zones: Array<{ key: DriveZoneKey; name: string; folderId: string }>;
}> {
  invalidateDriveCache();
  const zones = await ensureZoneFolders(cfg);
  return {
    root: cfg.rootFolderId,
    zones: (Object.keys(DRIVE_ZONES) as DriveZoneKey[]).map(key => ({
      key,
      name: DRIVE_ZONES[key],
      folderId: zones[key]
    }))
  };
}