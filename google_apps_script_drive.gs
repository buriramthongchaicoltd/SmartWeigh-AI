/**
 * ==============================================================================
 * SmartWeigh AI — Google Apps Script (GAS) Drive Engine
 * ระบบจัดเก็บและจัดการไฟล์ Google Drive อัตโนมัติ (Zero-Junk & Verified-Only Move)
 * ใช้งานผ่านบัญชี Google ส่วนตัวได้ทันที — ไม่ต้องใช้ Google Service Account
 * ==============================================================================
 * 
 * 📌 ขั้นตอนการติดตั้ง (ทำครั้งเดียว 1 นาที):
 * 1. เปิด https://script.google.com แล้วกดปุ่ม "+ โครงการใหม่" (New project)
 * 2. ลบโค้ดเดิมในหน้าต่างออกทั้งหมด แล้วคัดลอกโค้ดไฟล์นี้ทั้งหมดไปวาง
 * 3. กดปุ่ม "การทำให้ใช้งานได้" (Deploy) มุมขวาบน -> เลือก "การทำให้ใช้งานได้รายการใหม่" (New deployment)
 * 4. คลิกที่ไอคอนฟันเฟือง ⚙️ ทางซ้าย แล้วเลือก "เว็บแอป" (Web app)
 * 5. กำหนดค่าดังนี้:
 *    - คำอธิบาย (Description): SmartWeigh Drive API
 *    - ดำเนินการในฐานะ (Execute as): "ฉัน (Me)"
 *    - ผู้ที่มีสิทธิ์เข้าถึง (Who has access): "ทุกคน (Anyone)"  <-- สำคัญมาก! เพื่อให้ระบบส่งรูปเข้ามาได้
 * 6. กดปุ่ม "ทำให้ใช้งานได้" (Deploy) -> กด "ให้สิทธิ์การเข้าถึง" (Authorize access) แล้วกดยอมรับ
 * 7. ไปที่ Project Settings -> Script Properties แล้วเพิ่ม
 *    SMARTWEIGH_SHARED_SECRET โดยใช้ค่าเดียวกับ Render environment variable
 *    (อย่างน้อย 32 ตัวอักษร; ห้ามเปิดเผยหรือบันทึกลง source code)
 * 8. คัดลอก Web app URL ที่ลงท้ายด้วย /exec ไปวางในหน้าตั้งค่า SmartWeigh AI
 *    และ Deploy source รุ่นนี้ใหม่ทุกครั้งเมื่อเปลี่ยนโค้ด
 * ==============================================================================
 */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, error: 'ไม่พบข้อมูลคำขอ (No POST payload)' });
    }

    var payload = JSON.parse(e.postData.contents);
    var expectedSecret = PropertiesService.getScriptProperties().getProperty('SMARTWEIGH_SHARED_SECRET');
    if (!expectedSecret || typeof payload.sharedSecret !== 'string' || payload.sharedSecret !== expectedSecret) {
      return jsonResponse({ success: false, error: 'Unauthorized' });
    }
    delete payload.sharedSecret;
    var action = payload.action;

    if (action === 'test') {
      return handleTestConnection(payload);
    } else if (action === 'upload') {
      return handleUploadFile(payload);
    } else if (action === 'sync_verified_move') {
      return handleMoveFile(payload);
    } else if (action === 'rename_and_move') {
      return handleRenameAndMoveFile(payload);
    } else if (action === 'cleanup') {
      return handleCleanup(payload);
    } else if (action === 'list_zone_files') {
      return handleListZoneFiles(payload);
    } else if (action === 'quarantine_inbox_file') {
      return handleQuarantineInboxFile(payload);
    } else {
      return jsonResponse({ success: false, error: 'ไม่รู้จัก action: ' + action });
    }
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function doGet(e) {
  return jsonResponse({
    success: true,
    service: 'SmartWeigh AI - Google Drive Engine (GAS)',
    status: 'Ready',
    timestamp: new Date().toISOString()
  });
}

// ------------------------------------------------------------------------------
// Handlers & Zone Definitions
// ------------------------------------------------------------------------------

var ZONE_NAMES = {
  ZONE_00: '00_กล่องพักบิล_LINE_รอตรวจรับ',
  ZONE_01: '01_ใบสั่งซื้อ_PO',
  ZONE_02: '02_ใบงานหลัก_DO_ครบชุด',
  ZONE_03: '03_ตั๋วชั่งปลายทาง_รอจับคู่DO',
  ZONE_04: '04_ใบเสร็จกำกับภาษี_เอกเทศ',
  ZONE_99: '99_ถังขยะ_รอทำลาย_30วัน'
};

var ZONE_KEY_MAP = {
  'zone_00': 'ZONE_00',
  'zone_01': 'ZONE_01',
  'zone_02': 'ZONE_02',
  'zone_03': 'ZONE_03',
  'zone_04': 'ZONE_04',
  'trash': 'ZONE_99'
};

function getOrCreateSubfolder(parentFolder, folderName) {
  var folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder.createFolder(folderName);
}

function handleTestConnection(payload) {
  var rootFolderId = payload.rootFolderId;
  if (!rootFolderId) {
    return jsonResponse({ success: false, error: 'กรุณาระบุ rootFolderId' });
  }

  var rootFolder;
  try {
    rootFolder = DriveApp.getFolderById(rootFolderId);
  } catch (err) {
    return jsonResponse({ success: false, error: 'ไม่พบโฟลเดอร์หลัก กรุณาตรวจสอบ Root Folder ID: ' + err.toString() });
  }

  var zonesCreated = {};
  for (var key in ZONE_NAMES) {
    var folder = getOrCreateSubfolder(rootFolder, ZONE_NAMES[key]);
    zonesCreated[key] = folder.getId();
  }

  return jsonResponse({
    success: true,
    message: 'เชื่อมต่อ Google Drive ผ่าน Google Apps Script สำเร็จ และตรวจสอบ 5 โซนมาตรฐานเรียบร้อย',
    rootFolderId: rootFolder.getId(),
    rootFolderName: rootFolder.getName(),
    zonesCreated: zonesCreated
  });
}

function handleUploadFile(payload) {
  var rootFolderId = payload.rootFolderId;
  var targetFolderId = payload.targetFolderId;
  var targetZone = payload.targetZone; // 'zone_00' | 'zone_01' | 'zone_02' | 'zone_03' | 'zone_04'
  var subfolderName = payload.subfolderName; // เช่น TR-xxxx_DO-xxxx
  var fileName = payload.fileName || ('FILE_' + Date.now() + '.jpg');
  var base64Image = payload.base64Image;

  if (!base64Image) {
    return jsonResponse({ success: false, error: 'ไม่พบข้อมูลรูปภาพ base64Image' });
  }

  var rootFolder;
  try {
    rootFolder = DriveApp.getFolderById(rootFolderId);
  } catch (err) {
    return jsonResponse({ success: false, error: 'ไม่พบโฟลเดอร์หลัก: ' + err.toString() });
  }

  var destFolder;
  if (targetFolderId) {
    try {
      destFolder = DriveApp.getFolderById(targetFolderId);
    } catch (e) {
      destFolder = rootFolder;
    }
  } else if (targetZone && ZONE_KEY_MAP[targetZone]) {
    var zoneName = ZONE_NAMES[ZONE_KEY_MAP[targetZone]];
    destFolder = getOrCreateSubfolder(rootFolder, zoneName);
  } else {
    destFolder = rootFolder;
  }

  // หากระบุชื่อโฟลเดอร์ย่อย (เช่น โฟลเดอร์ใบงานประจำ DO ใน 02_ใบงานหลัก_DO_ครบชุด)
  if (subfolderName) {
    destFolder = getOrCreateSubfolder(destFolder, subfolderName);
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var existingFiles = destFolder.getFilesByName(fileName);
    if (existingFiles.hasNext()) {
      var existingFile = existingFiles.next();
      return jsonResponse({
        success: true,
        alreadyExists: true,
        fileId: existingFile.getId(),
        fileName: existingFile.getName(),
        folderId: destFolder.getId(),
        webViewLink: existingFile.getUrl()
      });
    }

    // ตัด Prefix data:image/...;base64, ออกหากมี
    var cleanBase64 = base64Image.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
    var decodedBytes = Utilities.base64Decode(cleanBase64);
    var blob = Utilities.newBlob(decodedBytes, 'image/jpeg', fileName);
    var file = destFolder.createFile(blob);

    return jsonResponse({
      success: true,
      fileId: file.getId(),
      fileName: file.getName(),
      folderId: destFolder.getId(),
      webViewLink: file.getUrl()
    });
  } finally {
    lock.releaseLock();
  }
}

function handleMoveFile(payload) {
  var fileId = payload.fileId;
  var targetFolderId = payload.targetFolderId;
  var rootFolderId = payload.rootFolderId;
  var targetZone = payload.targetZone;
  var subfolderName = payload.subfolderName;

  if (!fileId) {
    return jsonResponse({ success: false, error: 'ระบุ fileId ไม่ครบ' });
  }

  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    return jsonResponse({ success: false, error: 'ไม่พบไฟล์: ' + e.toString() });
  }

  var targetFolder;
  if (targetFolderId) {
    try {
      targetFolder = DriveApp.getFolderById(targetFolderId);
    } catch (e) {
      return jsonResponse({ success: false, error: 'ไม่พบโฟลเดอร์ปลายทาง: ' + e.toString() });
    }
  } else if (rootFolderId && targetZone && ZONE_KEY_MAP[targetZone]) {
    var rootFolder = DriveApp.getFolderById(rootFolderId);
    var zoneName = ZONE_NAMES[ZONE_KEY_MAP[targetZone]];
    targetFolder = getOrCreateSubfolder(rootFolder, zoneName);
    if (subfolderName) {
      targetFolder = getOrCreateSubfolder(targetFolder, subfolderName);
    }
  } else {
    return jsonResponse({ success: false, error: 'ไม่ระบุเป้าหมายการย้ายไฟล์' });
  }

  file.moveTo(targetFolder);

  return jsonResponse({
    success: true,
    fileId: file.getId(),
    targetFolderId: targetFolder.getId(),
    message: 'ย้ายไฟล์ไปยังโฟลเดอร์เป้าหมายสำเร็จ'
  });
}

// Rename a file and optionally move it to a target zone in one atomic call
function handleRenameAndMoveFile(payload) {
  var fileId       = payload.fileId;        // Drive file ID to rename+move
  var newFileName  = payload.newFileName;   // New filename including extension
  var rootFolderId = payload.rootFolderId;
  var targetZone   = payload.targetZone;    // 'zone_01' | 'zone_02' | 'zone_03' | 'zone_04'
  var subfolderName = payload.subfolderName; // optional sub-folder inside zone (e.g. TR-xxx_DO-xxx)

  if (!fileId || !newFileName) {
    return jsonResponse({ success: false, error: 'ระบุ fileId และ newFileName ไม่ครบ' });
  }

  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    return jsonResponse({ success: false, error: 'ไม่พบไฟล์: ' + e.toString() });
  }

  // 1. Rename
  file.setName(newFileName);

  // 2. Move (optional)
  if (rootFolderId && targetZone && ZONE_KEY_MAP[targetZone]) {
    try {
      var rootFolder = DriveApp.getFolderById(rootFolderId);
      var zoneName   = ZONE_NAMES[ZONE_KEY_MAP[targetZone]];
      var targetFolder = getOrCreateSubfolder(rootFolder, zoneName);
      if (subfolderName) {
        targetFolder = getOrCreateSubfolder(targetFolder, subfolderName);
      }
      file.moveTo(targetFolder);
      return jsonResponse({
        success: true,
        fileId: file.getId(),
        fileName: file.getName(),
        targetFolderId: targetFolder.getId(),
        message: 'เปลี่ยนชื่อและย้ายไฟล์สำเร็จ'
      });
    } catch (e) {
      return jsonResponse({ success: false, error: 'เปลี่ยนชื่อสำเร็จแต่ย้ายโฟลเดอร์ไม่ได้: ' + e.toString() });
    }
  }

  return jsonResponse({
    success: true,
    fileId: file.getId(),
    fileName: file.getName(),
    message: 'เปลี่ยนชื่อไฟล์สำเร็จ (ไม่ได้ย้ายโฟลเดอร์)'
  });
}

function handleCleanup(payload) {
  var fileId = payload.fileId;
  var folderId = payload.folderId;
  var rescueFileId = payload.rescueFileId;
  var rescueTargetFolderId = payload.rescueTargetFolderId;
  var rootFolderId = payload.rootFolderId;

  // Rescue Rule: กู้ตั๋วชั่งปลายทางกลับโฟลเดอร์ 03 ก่อนลบโฟลเดอร์ DO
  if (rescueFileId) {
    try {
      var rFile = DriveApp.getFileById(rescueFileId);
      var rTarget;
      if (rescueTargetFolderId) {
        rTarget = DriveApp.getFolderById(rescueTargetFolderId);
      } else if (rootFolderId) {
        var rootFolder = DriveApp.getFolderById(rootFolderId);
        rTarget = getOrCreateSubfolder(rootFolder, ZONE_NAMES.ZONE_03);
      }
      if (rTarget) {
        rFile.moveTo(rTarget);
      }
    } catch (e) {
      // ข้ามหากไฟล์เดิมไม่มีอยู่แล้ว
    }
  }

  if (fileId) {
    var file = DriveApp.getFileById(fileId);
    file.setTrashed(true);
  }

  if (folderId) {
    try {
      var folder = DriveApp.getFolderById(folderId);
      folder.setTrashed(true);
    } catch (e) {}
  }

  return jsonResponse({
    success: true,
    message: 'ทำความสะอาดไฟล์ขยะ (Zero-Junk Cleanup) สำเร็จ'
  });
}

function handleListZoneFiles(payload) {
  var rootFolderId = payload.rootFolderId;
  if (!rootFolderId) {
    return jsonResponse({ success: false, error: 'กรุณาระบุ rootFolderId' });
  }

  var root = DriveApp.getFolderById(rootFolderId);
  var zone00Folders = root.getFoldersByName(ZONE_NAMES.ZONE_00);
  if (!zone00Folders.hasNext()) {
    return jsonResponse({ success: true, files: [], totalCount: 0 });
  }

  var files = [];
  var iterator = zone00Folders.next().getFiles();
  var maxFiles = 2000;
  while (iterator.hasNext() && files.length < maxFiles) {
    var file = iterator.next();
    var fileId = file.getId();
    files.push({
      id: fileId,
      name: file.getName(),
      createdTime: file.getDateCreated().toISOString(),
      webViewLink: 'https://drive.google.com/file/d/' + fileId + '/view'
    });
  }

  return jsonResponse({
    success: true,
    files: files,
    totalCount: files.length,
    hasMore: iterator.hasNext()
  });
}

function handleQuarantineInboxFile(payload) {
  var rootFolderId = payload.rootFolderId;
  var fileId = payload.fileId;
  if (!rootFolderId || !fileId) {
    return jsonResponse({ success: false, error: 'กรุณาระบุ rootFolderId และ fileId' });
  }

  var root = DriveApp.getFolderById(rootFolderId);
  var zone00Folders = root.getFoldersByName(ZONE_NAMES.ZONE_00);
  var quarantineFolder = getOrCreateSubfolder(root, ZONE_NAMES.ZONE_99);
  if (!zone00Folders.hasNext()) {
    return jsonResponse({
      success: true,
      quarantined: false,
      message: 'ไม่พบโฟลเดอร์ 00 จึงข้ามการย้ายไฟล์; ลบเฉพาะรายการในกล่องพักได้'
    });
  }

  var zone00 = zone00Folders.next();
  var file = DriveApp.getFileById(fileId);
  var parents = file.getParents();
  var isInInboxZone = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === zone00.getId()) {
      isInInboxZone = true;
      break;
    }
  }
  if (!isInInboxZone) {
    return jsonResponse({
      success: true,
      quarantined: false,
      message: 'ไฟล์ไม่ได้อยู่ในโฟลเดอร์ 00 จึงข้ามการย้ายไฟล์; ลบเฉพาะรายการในกล่องพักได้'
    });
  }

  file.moveTo(quarantineFolder);
  return jsonResponse({
    success: true,
    fileId: fileId,
    quarantineFolder: ZONE_NAMES.ZONE_99
  });
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
